import { ALARM_NAME } from '@claude-reset/shared';
import type { Session } from '@claude-reset/shared';
import { getStoredSession, setStoredSession, getResetWindowMs } from '../lib/storage';

/**
 * Called by the background SW whenever either detection signal fires.
 *
 * Returns true if a NEW session was started, false if an existing active
 * session was found (so the caller knows whether to sync to Firestore).
 *
 * Idempotency guarantee:
 *   - If a session is active (now < resetTime), this is a no-op.
 *   - Multiple signals from the same prompt (DOM + network) within the debounce
 *     window will not create two sessions.
 */
export async function handleSessionStart(timestamp: number): Promise<boolean> {
  const existing = await getStoredSession();

  if (existing !== null && timestamp < existing.resetTime) {
    // An active session exists — this is just another message in the same window
    return false;
  }

  const resetWindowMs = await getResetWindowMs();
  const session: Session = {
    sessionStart: timestamp,
    resetTime: timestamp + resetWindowMs,
    notified: false,
  };

  // Persist locally FIRST (synchronous path — doesn't depend on network)
  await setStoredSession(session);

  // Cancel any previous alarm and schedule the new one
  // chrome.alarms survives service worker termination — this is what makes
  // desktop notifications reliable even when the browser is backgrounded.
  chrome.alarms.clear(ALARM_NAME, () => {
    chrome.alarms.create(ALARM_NAME, { when: session.resetTime });
  });

  console.log(
    `[Claude Reset] New session started.\n` +
    `  Start : ${new Date(session.sessionStart).toLocaleTimeString()}\n` +
    `  Reset : ${new Date(session.resetTime).toLocaleTimeString()}`,
  );

  return true;
}

/**
 * Mark the session as notified so repeated alarm fires don't send duplicate
 * notifications (can happen if the SW restarts exactly at alarm time).
 */
export async function markSessionNotified(): Promise<void> {
  const session = await getStoredSession();
  if (session) {
    await setStoredSession({ ...session, notified: true });
  }
}
