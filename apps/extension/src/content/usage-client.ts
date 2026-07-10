/**
 * Bridge client — runs in the isolated-world content script (detector.ts).
 * Talks to injected/usage-bridge.ts (MAIN world) via window.postMessage,
 * since isolated and MAIN worlds cannot share JS references or call each
 * other's functions directly — postMessage is the only channel between them.
 */

import type { UsageResponse } from '@claude-reset/shared';

const BRIDGE_MARKER = 'ClaudeResetNotifier';
const REQUEST_TIMEOUT_MS = 10_000;

interface PendingRequest {
  resolve: (value: UsageResponse) => void;
  reject: (reason: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingRequest>();

function makeRequestId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Registered once, handles all responses regardless of which request() call is waiting
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data as {
    crn?: string;
    type?: string;
    requestId?: string;
    ok?: boolean;
    payload?: UsageResponse | null;
    error?: string | null;
  };

  if (!data || data.crn !== BRIDGE_MARKER || data.type !== 'crn:usage-response') return;
  if (!data.requestId) return;

  const request = pending.get(data.requestId);
  if (!request) return; // already timed out, or not ours

  pending.delete(data.requestId);
  clearTimeout(request.timeoutId);

  if (data.ok && data.payload) {
    request.resolve(data.payload);
  } else {
    request.reject(new Error(data.error ?? 'Usage bridge request failed'));
  }
});

/**
 * Request the current usage data from Anthropic's GET /usage endpoint,
 * via the MAIN-world injected script.
 *
 * Rejects if:
 *   - The MAIN-world script hasn't loaded yet (rare — declarative MAIN world
 *     injection runs alongside the isolated content script, not after it)
 *   - The fetch itself fails (network error, non-200 response, CORS issue)
 *   - The request times out (10s — generous, this is a simple GET)
 *
 * Callers should always wrap this in a try/catch and fall back to local
 * DOM/network-based estimation on failure — this endpoint is undocumented
 * and Anthropic could change or restrict it without notice.
 */
export function requestUsage(orgId: string): Promise<UsageResponse> {
  const requestId = makeRequestId();

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('Usage bridge request timed out'));
    }, REQUEST_TIMEOUT_MS);

    pending.set(requestId, { resolve, reject, timeoutId });

    window.postMessage(
      { crn: BRIDGE_MARKER, type: 'crn:request-usage', requestId, orgId },
      '*',
    );
  });
}

/**
 * Reads the lastActiveOrg cookie directly via document.cookie.
 * Confirmed non-HttpOnly (readable from a normal content script) — this is
 * how Claude's own account/org context is scoped, and how the real Claude
 * Counter extension reads it (verified in its source, not assumed).
 */
export function getOrgIdFromCookie(): string | null {
  try {
    return (
      document.cookie
        .split('; ')
        .find((row) => row.startsWith('lastActiveOrg='))
        ?.split('=')[1] || null
    );
  } catch {
    return null;
  }
}
