/**
 * Background Service Worker
 *
 * Message priority (highest trust first):
 *   1. USAGE_UPDATE            — authoritative, from GET /usage (detector.ts)
 *   2. SESSION_PROMPT_DETECTED — local estimate fallback (DOM/network signal)
 *   3. SESSION_RECOVERY        — local estimate fallback (mid-session DOM scan)
 *
 * See session.ts for the full trust/precedence logic between these.
 *
 * Notification architecture:
 *   All notifications go through notifications/manager.ts's notifyReset().
 *   This file never implements notification logic directly — it only
 *   decides WHEN to fire an event and WHAT event to pass.
 */

import { ALARM_NAME, REMINDER_ALARM_NAME } from '@claude-reset/shared';
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
import { syncSessionToFirestore, fetchRemoteResetWindow } from './sync';
import { notifyReset } from './notifications/manager';
import { startReminders, stopReminders } from './notifications/reminder';
import { isOurNotificationId } from './notifications/channels/desktop';
import { resolveSoundUrl } from './notifications/sound-sources';
import { playSoundViaOffscreen } from './notifications/offscreen-manager';
import { getNotificationPreferences } from './notifications/preferences';

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

// ── "User opens Claude" — a reminder stop condition ───────────────────────────

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.startsWith('https://claude.ai')) {
    stopReminders();
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url?.startsWith('https://claude.ai')) {
      stopReminders();
    }
  } catch {
    // Tab may have closed between the event firing and this lookup — harmless
  }
});

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (rawMessage: unknown, _sender, sendResponse) => {
    const message = rawMessage as ContentMessage;

    // ── Authoritative usage data from GET /usage ───────────────────────────────
    if (message.type === 'USAGE_UPDATE') {
      void (async () => {
        const user = await getStoredUser();
        if (!user) { sendResponse({ ok: false }); return; }

        await applyAuthoritativeUsage(message.resetsAtMs, message.hasUsageEvidence);

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
            stopReminders();
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

    // ── Mark as Seen — stops any active reminder cycle, clears the badge ───────
    if (message.type === 'MARK_AS_SEEN') {
      void (async () => {
        stopReminders();
        await chrome.action.setBadgeText({ text: '' });
        sendResponse({ ok: true });
      })();
      return true;
    }

    // ── Test Sound — plays immediately, bypasses NotificationManager entirely ─
    //    since this is a direct user-initiated check, not a reset event, and
    //    should ignore the sound-enabled toggle (testing should always work).
    if (message.type === 'TEST_SOUND') {
      void (async () => {
        const prefs = await getNotificationPreferences();
        const url = resolveSoundUrl(message.soundId);
        try {
          await playSoundViaOffscreen(url, prefs.sound.volumeMode, prefs.sound.volumePercent);
          sendResponse({ ok: true });
        } catch (err) {
          console.warn('[Claude Reset] Test sound failed:', err);
          sendResponse({ ok: false });
        }
      })();
      return true;
    }

    // ── Sign-out ──────────────────────────────────────────────────────────────
    if (message.type === 'SIGN_OUT') {
      void (async () => {
        chrome.alarms.clear(ALARM_NAME);
        stopReminders();
        await clearAllStorage();
        sendResponse({ ok: true });
      })();
      return true;
    }

    return false;
  },
);

// ── Alarm handler: initial reset notification + reminder cycle ────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    const session = await getStoredSession();
    if (!session || session.notified) return;

    await markSessionNotified();
    await notifyReset({ kind: 'initial', resetTime: session.resetTime, utilization: null });
    await startReminders();

    console.log('[Claude Reset] Initial reset notification fired');
    return;
  }

  if (alarm.name === REMINDER_ALARM_NAME) {
    const session = await getStoredSession();
    if (!session) {
      // No session on record at all — nothing to remind about, stop the cycle.
      stopReminders();
      return;
    }

    await notifyReset({ kind: 'reminder', resetTime: session.resetTime, utilization: null });
    console.log('[Claude Reset] Reminder notification fired');
  }
});

// ── OS notification click → open Claude, stop reminders ───────────────────────

chrome.notifications.onClicked.addListener((notificationId) => {
  if (!isOurNotificationId(notificationId)) return;
  chrome.tabs.create({ url: 'https://claude.ai' });
  chrome.notifications.clear(notificationId);
  stopReminders(); // clicking through counts as "manually dismisses"
});

// ── Service worker lifecycle ──────────────────────────────────────────────────

self.addEventListener('install', () => {
  console.log('[Claude Reset] Service worker installed');
  void (self as unknown as { skipWaiting: () => Promise<void> }).skipWaiting();
});

self.addEventListener('activate', () => {
  console.log('[Claude Reset] Service worker activated');

  // Refresh the remote resetWindowMs config once per activation. Only matters
  // for the local-estimate fallback path (see session.ts) — when GET /usage
  // succeeds, resetTime is authoritative from Anthropic and never touches
  // this cached value at all.
  void (async () => {
    const user = await getStoredUser();
    if (!user) return; // no point fetching config before anyone's signed in
    await fetchRemoteResetWindow();
  })();
});
