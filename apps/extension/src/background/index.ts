/**
 * Background Service Worker
 *
 * Message priority (highest trust first):
 *   1. USAGE_UPDATE          — authoritative, from GET /usage (detector.ts)
 *   2. SESSION_PROMPT_DETECTED — local estimate fallback (DOM/network signal)
 *   3. SESSION_RECOVERY      — local estimate fallback (mid-session DOM scan)
 *
 * See session.ts for the full trust/precedence logic between these.
 */

import { ALARM_NAME, NOTIFICATION_ID } from '@claude-reset/shared';
import type { ContentMessage } from '@claude-reset/shared';
import { applyAuthoritativeUsage, handleLocalEstimate, markSessionNotified } from './session';
import {
  getStoredUser,
  getStoredSession,
  setStoredSession,
  clearAllStorage,
  getResetWindowMs,
  setMidSessionDetected,
} from '../lib/storage';
import { syncSessionToFirestore } from './sync';
import { fireResetNotification } from './notifications';

// ── Secondary detection: network signal (fallback only) ──────────────────────

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.method !== 'POST') return;
    void (async () => {
      const user = await getStoredUser();
      if (!user) return;

      const wasNew = await handleLocalEstimate(Date.now());
      if (wasNew) {
        console.log('[Claude Reset] Session started via network signal (fallback)');
        const session = await getStoredSession();
        if (session) syncSessionToFirestore(session, user).catch(console.error);
      }
    })();
  },
  { urls: ['https://claude.ai/api/*'] },
);

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (rawMessage: unknown, _sender, sendResponse) => {
    const message = rawMessage as ContentMessage;

    // ── Authoritative usage data from GET /usage ───────────────────────────────
    if (message.type === 'USAGE_UPDATE') {
      void (async () => {
        const user = await getStoredUser();
        if (!user) { sendResponse({ ok: false }); return; }

        await applyAuthoritativeUsage(message.resetsAtMs);

        const session = await getStoredSession();
        if (session) syncSessionToFirestore(session, user).catch(console.error);

        sendResponse({ ok: true });
      })();
      return true;
    }

    // ── Fallback: DOM signal (only reached when GET /usage failed) ────────────
    if (message.type === 'SESSION_PROMPT_DETECTED') {
      void (async () => {
        const user = await getStoredUser();
        if (!user) { sendResponse({ ok: false }); return; }

        const wasNew = await handleLocalEstimate(message.timestamp);
        if (wasNew) {
          console.log('[Claude Reset] Session started via DOM signal (fallback)');
          const session = await getStoredSession();
          if (session) syncSessionToFirestore(session, user).catch(console.error);
        }
        sendResponse({ ok: true });
      })();
      return true;
    }

    // ── Fallback: mid-session DOM recovery (only reached when GET /usage failed) ─
    if (message.type === 'SESSION_RECOVERY') {
      void (async () => {
        const user = await getStoredUser();
        if (!user) { sendResponse({ ok: false }); return; }

        const existing = await getStoredSession();
        if (existing && !existing.notified && Date.now() < existing.resetTime) {
          console.log('[Claude Reset] Recovery skipped — session already tracked');
          sendResponse({ ok: true });
          return;
        }

        if (message.estimatedStart !== null) {
          const resetWindowMs = await getResetWindowMs();
          const resetTime = message.estimatedStart + resetWindowMs;

          if (Date.now() < resetTime) {
            await setStoredSession({
              sessionStart: message.estimatedStart,
              resetTime,
              notified: false,
              source: 'local-estimate',
            });
            chrome.alarms.clear(ALARM_NAME, () => {
              chrome.alarms.create(ALARM_NAME, { when: resetTime });
            });
            console.log(
              `[Claude Reset] Session recovered from DOM scan (fallback).\n` +
              `  Start : ${new Date(message.estimatedStart!).toLocaleTimeString()}\n` +
              `  Reset : ${new Date(resetTime).toLocaleTimeString()}`,
            );
            const freshSession = await getStoredSession();
            if (freshSession) syncSessionToFirestore(freshSession, user).catch(console.error);
          } else {
            console.log('[Claude Reset] Recovery: timestamp found but session already expired');
          }
        } else if (message.hasExistingMessages) {
          await setMidSessionDetected(true);
          console.log('[Claude Reset] Mid-session detected — start time unavailable (fallback path)');
        }

        sendResponse({ ok: true });
      })();
      return true;
    }

    // ── Sign-out ──────────────────────────────────────────────────────────────
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

// ── Alarm handler: fires the layered notification at reset time ───────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const session = await getStoredSession();
  if (!session || session.notified) return;

  await markSessionNotified();
  await fireResetNotification();

  console.log('[Claude Reset] Reset notification fired');
});

// ── OS notification click → open Claude ──────────────────────────────────────

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId !== NOTIFICATION_ID) return;
  chrome.tabs.create({ url: 'https://claude.ai' });
  chrome.notifications.clear(NOTIFICATION_ID);
});

// ── Service worker lifecycle ──────────────────────────────────────────────────

self.addEventListener('install', () => {
  console.log('[Claude Reset] Service worker installed');
  void (self as unknown as { skipWaiting: () => Promise<void> }).skipWaiting();
});

self.addEventListener('activate', () => {
  console.log('[Claude Reset] Service worker activated');
});
