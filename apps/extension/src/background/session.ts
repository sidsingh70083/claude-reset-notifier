import { ALARM_NAME } from '@claude-reset/shared';
import type { Session } from '@claude-reset/shared';
import { getStoredSession, setStoredSession, getResetWindowMs, setMidSessionDetected } from '../lib/storage';
import { stopReminders } from './notifications/reminder';

/**
 * Applies AUTHORITATIVE usage data from GET /usage. This is always preferred
 * over local DOM/network estimation — see detector.ts and usage-bridge.ts.
 *
 * Three cases:
 *   1. resetsAtMs is in the future  → active session, recover/update it exactly
 *   2. resetsAtMs is in the past    → no active session right now (between windows)
 *   3. resetsAtMs is null           → Anthropic returned no five_hour data at all
 *      (new account, no messages sent yet, or the field was omitted) — treat as no-op,
 *      let DOM/network detection handle the actual first-prompt-of-the-day case.
 *
 * Idempotency: if the new resetsAtMs matches what's already stored, skip the
 * storage write and alarm re-creation entirely — this function gets called
 * on every detected prompt, and re-arming an identical alarm repeatedly is
 * wasted work (chrome.alarms.create silently replaces, but there's no reason
 * to churn it).
 */
export async function applyAuthoritativeUsage(resetsAtMs: number | null): Promise<void> {
  if (resetsAtMs === null) return;

  const existing = await getStoredSession();
  const now = Date.now();

  if (resetsAtMs <= now) {
    // No active session according to Anthropic right now. If we have a stale
    // stored session from a prior window, clear it so the popup reflects reality
    // rather than showing a countdown that has already silently expired.
    if (existing && existing.source === 'usage-endpoint' && existing.resetTime <= now) {
      await setStoredSession(null);
      chrome.alarms.clear(ALARM_NAME);
    }
    return;
  }

  // Active session. Skip redundant writes if nothing changed.
  if (existing && existing.source === 'usage-endpoint' && existing.resetTime === resetsAtMs) {
    return;
  }

  const resetWindowMs = await getResetWindowMs();
  const session: Session = {
    // Back-computed for display only — NOT authoritative. The alarm below
    // uses resetsAtMs directly, which IS authoritative.
    sessionStart: resetsAtMs - resetWindowMs,
    resetTime: resetsAtMs,
    notified: false,
    source: 'usage-endpoint',
  };

  await setStoredSession(session);
  await setMidSessionDetected(false); // we now have real data — no need for the ambiguous state

  // A brand-new session starting is one of the four reminder stop conditions —
  // whatever reminder cycle was running for the PREVIOUS session must not
  // bleed into this one.
  stopReminders();

  chrome.alarms.clear(ALARM_NAME, () => {
    chrome.alarms.create(ALARM_NAME, { when: session.resetTime });
  });

  console.log(
    `[Claude Reset] Session synced from GET /usage (authoritative).\n` +
    `  Reset : ${new Date(session.resetTime).toLocaleTimeString()}`,
  );
}

/**
 * FALLBACK ONLY — used when GET /usage failed (see detector.ts).
 * Estimates resetTime locally as sessionStart + RESET_WINDOW_MS.
 *
 * Returns true if a NEW session was started, false if an existing active,
 * un-notified, endpoint-sourced session already covers this timestamp
 * (in which case the authoritative data should not be overwritten by a guess).
 */
export async function handleLocalEstimate(timestamp: number): Promise<boolean> {
  const existing = await getStoredSession();

  // Never let a local estimate override authoritative endpoint data that's
  // still valid — the endpoint is always more trustworthy when available.
  if (
    existing !== null &&
    existing.source === 'usage-endpoint' &&
    !existing.notified &&
    timestamp < existing.resetTime
  ) {
    return false;
  }

  // Same rearm-after-notified fix as before, now also source-aware.
  if (existing !== null && !existing.notified && timestamp < existing.resetTime) {
    return false;
  }

  const resetWindowMs = await getResetWindowMs();
  const session: Session = {
    sessionStart: timestamp,
    resetTime: timestamp + resetWindowMs,
    notified: false,
    source: 'local-estimate',
  };

  await setStoredSession(session);
  await setMidSessionDetected(false);

  stopReminders(); // same stop condition as above — new session begins

  chrome.alarms.clear(ALARM_NAME, () => {
    chrome.alarms.create(ALARM_NAME, { when: session.resetTime });
  });

  console.log(
    `[Claude Reset] New session started (local estimate — GET /usage unavailable).\n` +
    `  Start : ${new Date(session.sessionStart).toLocaleTimeString()}\n` +
    `  Reset : ${new Date(session.resetTime).toLocaleTimeString()}`,
  );

  return true;
}

export async function markSessionNotified(): Promise<void> {
  const session = await getStoredSession();
  if (session) {
    await setStoredSession({ ...session, notified: true });
  }
}
