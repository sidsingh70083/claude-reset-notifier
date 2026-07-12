/**
 * Content script injected on https://claude.ai/*
 *
 * ARCHITECTURE (post GET /usage integration):
 *
 * PRIMARY signal — GET /usage (authoritative, from Anthropic's own backend):
 *   - Called once on load (handles session recovery for mid-session installs)
 *   - Called again whenever a DOM/network signal fires (a prompt was sent)
 *   - Called again shortly after the last known resetTime passes (auto-rearm)
 *   Result is sent to background SW as USAGE_UPDATE with an authoritative resetTime.
 *
 * FALLBACK signal — DOM MutationObserver + network POST observation:
 *   Used only when GET /usage fails (endpoint blocked, no cookie, network error).
 *   Sends SESSION_PROMPT_DETECTED / SESSION_RECOVERY as before — background SW
 *   computes an ESTIMATED resetTime locally (sessionStart + RESET_WINDOW_MS).
 *
 * This endpoint is undocumented — see injected/usage-bridge.ts maintenance note.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { SESSION_START_DEBOUNCE_MS } from '@claude-reset/shared';
import { requestUsage, getOrgIdFromCookie } from './usage-client';

const USER_MESSAGE_SELECTORS: string[] = [
  '[data-is-human-turn="true"]',
  '[data-message-author-role="user"]',
  '[data-testid="human-turn"]',
  '.font-user-message',
  '[class*="human-turn"]',
  '[class*="user-message"]',
  '[class*="HumanTurn"]',
];

// ── Primary: GET /usage orchestration ────────────────────────────────────────

let lastKnownResetMs: number | null = null;
let rolloverCheckTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Fetches authoritative usage data and reports it to the background SW.
 * Returns true on success (background now has real data), false on any
 * failure (caller should rely on the DOM/network fallback instead).
 *
 * hasUsageEvidence must be supplied by the caller — this function only knows
 * about the network response, not WHY it was called. See each call site
 * below for what counts as evidence, and shared/types.ts's USAGE_UPDATE
 * variant for how the background SW uses this fact.
 */
async function refreshUsageFromEndpoint(hasUsageEvidence: boolean): Promise<boolean> {
  const orgId = getOrgIdFromCookie();
  if (!orgId) return false; // not signed in yet, or cookie not set — fallback handles this

  try {
    const usage = await requestUsage(orgId);
    const resetsAtMs = usage.fiveHour?.resetsAtMs ?? null;
    const utilization = usage.fiveHour?.utilization ?? null;

    await chrome.runtime.sendMessage({
      type: 'USAGE_UPDATE',
      resetsAtMs,
      utilization,
      hasUsageEvidence,
    });

    // Schedule a rollover recheck shortly after this window is expected to end.
    // This recheck's ONLY job is confirming the old window has truly ended and
    // clearing stale state — it must never create a new session on its own
    // (see the rollover callback below, which reports hasUsageEvidence: false).
    if (resetsAtMs !== null) {
      lastKnownResetMs = resetsAtMs;
      scheduleRolloverCheck(resetsAtMs);
    }

    return true;
  } catch {
    // Endpoint unavailable, blocked, or cookie missing — fallback path takes over
    return false;
  }
}

function scheduleRolloverCheck(resetMs: number): void {
  if (rolloverCheckTimer) clearTimeout(rolloverCheckTimer);

  const delay = Math.max(0, resetMs - Date.now()) + 15_000; // 15s buffer past reset
  rolloverCheckTimer = setTimeout(() => {
    // Only re-check if this is still the most recent known reset time
    // (avoids a stale timer firing after a newer one has already superseded it)
    if (lastKnownResetMs === resetMs) {
      // No evidence here — this recheck exists purely to clear stale state
      // once a window truly ends, never to create a new one from nothing.
      void refreshUsageFromEndpoint(false);
    }
  }, delay);
}

// ── Fallback: DOM detection ───────────────────────────────────────────────────

function isUserMessageNode(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  return USER_MESSAGE_SELECTORS.some((selector) => {
    try {
      return node.matches(selector) || node.querySelector(selector) !== null;
    } catch {
      return false;
    }
  });
}

function queryExistingUserMessages(): Element[] {
  for (const selector of USER_MESSAGE_SELECTORS) {
    try {
      const results = Array.from(document.querySelectorAll(selector));
      if (results.length > 0) return results;
    } catch {
      continue;
    }
  }
  return [];
}

function tryExtractTimestamp(element: Element): number | null {
  const candidates = [
    element,
    element.parentElement,
    element.closest('[data-is-human-turn]'),
    element.closest('[data-message-author-role]'),
  ].filter((el): el is Element => el !== null);

  for (const candidate of candidates) {
    const timeEl = candidate.querySelector('time[datetime]');
    if (timeEl) {
      const raw = timeEl.getAttribute('datetime');
      if (raw) {
        const ts = Date.parse(raw);
        if (!isNaN(ts) && ts > 0 && ts < Date.now()) return ts;
      }
    }
  }

  const timestampAttrs = ['data-timestamp', 'data-created-at', 'data-time', 'data-date'];
  for (const candidate of candidates) {
    for (const attr of timestampAttrs) {
      const raw = candidate.getAttribute(attr);
      if (!raw) continue;
      const numeric = parseInt(raw, 10);
      if (!isNaN(numeric) && numeric > 1_000_000_000_000 && numeric < Date.now()) return numeric;
      const parsed = Date.parse(raw);
      if (!isNaN(parsed) && parsed > 0 && parsed < Date.now()) return parsed;
    }
  }

  for (const candidate of candidates) {
    const withTitle = candidate.querySelector('[title]');
    if (withTitle) {
      const title = withTitle.getAttribute('title') ?? '';
      const ts = Date.parse(title);
      if (!isNaN(ts) && ts > Date.now() - 24 * 60 * 60 * 1_000 && ts < Date.now()) return ts;
    }
  }

  return null;
}

async function attemptDomRecovery(): Promise<void> {
  const existing = queryExistingUserMessages();
  if (existing.length === 0) return;

  const estimatedStart = tryExtractTimestamp(existing[0]);

  chrome.runtime
    .sendMessage({ type: 'SESSION_RECOVERY', hasExistingMessages: true, estimatedStart })
    .catch(() => { /* SW may be asleep, harmless */ });
}

let lastDetectedAt = 0;

function onPromptDetected(source: 'dom'): void {
  const now = Date.now();
  if (now - lastDetectedAt < SESSION_START_DEBOUNCE_MS) return;
  lastDetectedAt = now;

  // A detected DOM mutation matching a sent message IS real evidence usage
  // has started — always true here, unlike the page-load case below.
  void refreshUsageFromEndpoint(true).then((succeeded) => {
    if (!succeeded) {
      chrome.runtime
        .sendMessage({ type: 'SESSION_PROMPT_DETECTED', timestamp: now, source })
        .catch(() => { /* network signal in background SW independently catches this */ });
    }
  });
}

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (isUserMessageNode(node)) {
        onPromptDetected('dom');
        return;
      }
    }
  }
});

function startObserving(): void {
  observer.observe(document.body, { childList: true, subtree: true });
}

// ── Initialization ────────────────────────────────────────────────────────────

async function initialize(): Promise<void> {
  // ROOT CAUSE FIX: a bare page load must NOT be treated as evidence that
  // usage has started. The only legitimate reason a page load may create a
  // session is genuine mid-session recovery — real messages already visible
  // in the DOM, meaning a conversation is already actively underway. An
  // empty/fresh page has no such evidence, even though GET /usage may still
  // return a future resetsAtMs (see background/session.ts for why that
  // alone is not proof of an active session).
  const hasExistingMessages = queryExistingUserMessages().length > 0;

  const succeeded = await refreshUsageFromEndpoint(hasExistingMessages);

  // If the authoritative endpoint failed, fall back to scanning the DOM —
  // attemptDomRecovery() already correctly requires real existing messages
  // before recovering anything, so it never had this bug.
  if (!succeeded) {
    await attemptDomRecovery();
  }

  // Ongoing detection always runs, regardless of which path succeeded above —
  // it's what triggers refreshUsageFromEndpoint() on subsequent prompts.
  startObserving();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void initialize());
} else {
  void initialize();
}
