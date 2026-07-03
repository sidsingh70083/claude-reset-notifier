/**
 * Background Service Worker
 *
 * Responsibilities in M1–M3:
 *   1. Secondary detection: webRequest observer (corroborates content script DOM signal)
 *   2. Receive SESSION_PROMPT_DETECTED messages from the content script
 *   3. Delegate session logic to session.ts (idempotency, resetTime, alarm)
 *   4. Fire the desktop notification when chrome.alarms fires at resetTime
 *   5. Handle sign-out cleanup
 *
 * What it does NOT do in M1–M3:
 *   - Touch Firestore (M5)
 *   - Send phone push notifications (M8)
 */

import { ALARM_NAME, NOTIFICATION_ID } from '@claude-reset/shared';
import type { ContentMessage } from '@claude-reset/shared';
import { handleSessionStart, markSessionNotified } from './session';
import { getStoredUser, getStoredSession, clearAllStorage } from '../lib/storage';
import { syncSessionToFirestore } from './sync';

// ── Secondary detection: network signal ───────────────────────────────────────
//
// This runs in the background at all times, catching prompts even if the
// content script DOM signal fails (e.g., after a Claude UI redesign).
//
// webRequest in MV3 is read-only (no blocking), which is all we need.
// The listener MUST be registered at the top level (synchronously) — not
// inside an async function or another event handler — or MV3 will not
// attach it reliably.

chrome.webRequest.onBeforeRequest.addListener(
  // The webRequest callback type is synchronous — async logic goes in a void IIFE
  (details) => {
    if (details.method !== 'POST') return;
    void (async () => {
      const user = await getStoredUser();
      if (!user) return; // tracking requires sign-in

      const wasNew = await handleSessionStart(Date.now());
      if (wasNew) {
        console.log('[Claude Reset] Session started via network signal');
        const session = await getStoredSession();
        if (session) {
          // Fire-and-forget sync (M5 stub — no-op until M5 is implemented)
          syncSessionToFirestore(session, user).catch(console.error);
        }
      }
    })();
  },
  { urls: ['https://claude.ai/api/*'] },
);

// ── Primary detection: message from content script ───────────────────────────

chrome.runtime.onMessage.addListener(
  (rawMessage: unknown, _sender, sendResponse) => {
    const message = rawMessage as ContentMessage;

    if (message.type === 'SESSION_PROMPT_DETECTED') {
      void (async () => {
        const user = await getStoredUser();
        if (!user) {
          sendResponse({ ok: false });
          return;
        }

        const wasNew = await handleSessionStart(message.timestamp);
        if (wasNew) {
          console.log('[Claude Reset] Session started via DOM signal');
          const session = await getStoredSession();
          if (session) {
            syncSessionToFirestore(session, user).catch(console.error);
          }
        }
        sendResponse({ ok: true });
      })();

      // Return true to keep the message channel open for the async response
      return true;
    }

    if (message.type === 'SIGN_OUT') {
      void (async () => {
        chrome.alarms.clear(ALARM_NAME);
        await clearAllStorage();
        sendResponse({ ok: true });
      })();
      return true;
    }

    return false;
  },
);

// ── Desktop notification at reset time ───────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const session = await getStoredSession();

  // Guard: don't send twice if the SW restarts and re-processes the same alarm
  if (!session || session.notified) return;

  await markSessionNotified();

  chrome.notifications.create(NOTIFICATION_ID, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: '✅ Claude is ready',
    message: 'Your 5-hour session has reset. Click to open Claude.',
    priority: 2,
    requireInteraction: false,
  });

  console.log('[Claude Reset] Desktop notification sent');
});

// ── Notification click → open Claude ─────────────────────────────────────────

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId !== NOTIFICATION_ID) return;
  chrome.tabs.create({ url: 'https://claude.ai' });
  chrome.notifications.clear(NOTIFICATION_ID);
});

// ── Service worker lifecycle ──────────────────────────────────────────────────

self.addEventListener('install', () => {
  console.log('[Claude Reset] Service worker installed');
  // Force the new SW to activate immediately without waiting for old tabs to close
  void (self as unknown as { skipWaiting: () => Promise<void> }).skipWaiting();
});

self.addEventListener('activate', () => {
  console.log('[Claude Reset] Service worker activated');
});
