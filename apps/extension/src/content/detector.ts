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
 */
async function refreshUsageFromEndpoint(): Promise<boolean> {
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
    });

    // Schedule a rollover recheck shortly after this window is expected to end,
    // so the next session's real data is picked up automatically without
    // waiting for a new message to be sent (the SSE approach used by other
    // extensions can't do this — it only updates during active message sends).
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
      void refreshUsageFromEndpoint();
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

  // Always try the authoritative endpoint first — the DOM signal is now just
  // a trigger to go check real data, not the source of the timestamp itself.
  void refreshUsageFromEndpoint().then((succeeded) => {
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
  // 1. Try the authoritative endpoint immediately (handles mid-session recovery)
  const succeeded = await refreshUsageFromEndpoint();

  // 2. If it failed, fall back to scanning the DOM for existing messages
  if (!succeeded) {
    await attemptDomRecovery();
  }

  // 3. Ongoing detection always runs, regardless of which path succeeded above —
  //    it's what triggers refreshUsageFromEndpoint() on subsequent prompts.
  startObserving();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void initialize());
} else {
  void initialize();
}
