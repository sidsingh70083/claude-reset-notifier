import { ALARM_NAME } from '@claude-reset/shared';
import type { Session } from '@claude-reset/shared';
import { getStoredSession, setStoredSession, getResetWindowMs, setMidSessionDetected } from '../lib/storage';
import { stopReminders } from './notifications/reminder';

/**
 * Applies AUTHORITATIVE usage data from GET /usage. This is always preferred
 * over local DOM/network estimation — see detector.ts and usage-bridge.ts.
 *
 * ROOT CAUSE THIS FUNCTION FIXES (see chat history for the full trace):
 *   A future resetsAtMs from Anthropic's /usage endpoint is NOT proof that a
 *   session is actually active — that endpoint appears to expose the next
 *   rolling window's boundary proactively, even before any message has been
 *   sent in it. Treating "the endpoint returned a future timestamp" as
 *   equivalent to "usage has started" caused a phantom session to appear
 *   the instant claude.ai was merely opened, with no prompt sent.
 *
 *   The fix: a future resetsAtMs is only sufficient to CORRECT an already
 *   -active tracked session (that's not creating anything from nothing).
 *   Creating a BRAND NEW session requires hasUsageEvidence === true — a real
 *   local signal (a detected prompt, or genuine pre-existing messages found
 *   on page load) reported by the only code with visibility into it,
 *   detector.ts. See shared/types.ts's USAGE_UPDATE variant for exactly what
 *   counts as evidence at each call site.
 *
 * Four cases:
 *   1. resetsAtMs is null            → no-op, let DOM/network fallback handle it
 *   2. resetsAtMs is in the past     → no active session right now; clear any stale record
 *   3. resetsAtMs is in the future,
 *      an active session is already tracked → always safe to correct its timing,
 *      regardless of hasUsageEvidence (this is Issue 1's mid-session recovery
 *      path — must keep working exactly as before)
 *   4. resetsAtMs is in the future,
 *      nothing active is tracked      → only create a new session if
 *      hasUsageEvidence is true; otherwise remain in "Waiting For First Prompt"
 */
export async function applyAuthoritativeUsage(
  resetsAtMs: number | null,
  hasUsageEvidence: boolean,
): Promise<void> {
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

  // resetsAtMs is in the future from here on.
  const activeSession = existing !== null && !existing.notified && existing.resetTime > now ? existing : null;

  if (!activeSession && !hasUsageEvidence) {
    // Nothing is currently tracked as active, and this call carries no real
    // evidence that usage has actually started. A future resetsAtMs alone
    // is not proof — remain in "Waiting For First Prompt" rather than
    // fabricating a session from timing data alone.
    return;
  }

  // Either correcting an already-active session's timing (mid-session
  // recovery — must keep working), or creating a new one backed by real
  // evidence. Skip a redundant write if nothing actually changed.
  if (activeSession && activeSession.source === 'usage-endpoint' && activeSession.resetTime === resetsAtMs) {
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
    `[Claude Reset] Session synced from GET /usage (authoritative, evidence=${hasUsageEvidence}).\n` +
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
