/**
 * Injected script — runs in the MAIN world (the page's own JS context), NOT
 * the extension's isolated content script world.
 *
 * Why MAIN world at all, if isolated-world content scripts can also fetch
 * same-origin URLs with cookies included?
 *   They can, in most cases. But claude.ai's Content-Security-Policy and any
 *   future tightening of it is untested from our side. Claude Counter's real,
 *   published extension routes this exact call through MAIN world and is
 *   confirmed working in production — we're following the empirically-proven
 *   path rather than gambling on an untested shortcut.
 *
 * Why NOT the script-tag + web_accessible_resources technique Claude Counter uses?
 *   That technique exists for Firefox compatibility (their manifest supports
 *   Gecko down to v142). Our PRD targets Brave/Chrome only, so we use MV3's
 *   newer declarative `"world": "MAIN"` content_scripts field instead — same
 *   result, less code, one less moving part to maintain.
 *
 * Responsibilities:
 *   - Listen for a request from the isolated-world content script
 *   - Perform GET https://claude.ai/api/organizations/{orgId}/usage
 *   - Normalize the response into { fiveHour: { utilization, resetsAtMs } | null }
 *   - Post the result back via window.postMessage
 *
 * ─── MAINTENANCE NOTE ────────────────────────────────────────────────────────
 * This endpoint is undocumented. If Anthropic changes its shape or path:
 *   1. Open claude.ai, DevTools → Network tab, filter "usage"
 *   2. Confirm the current path and response shape
 *   3. Update USAGE_ENDPOINT_PATH and normalizeUsageResponse() below
 * If the endpoint disappears or starts rejecting these requests entirely,
 * the extension falls back to local DOM/network-based estimation automatically
 * — see content/detector.ts and background/session.ts.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const BRIDGE_MARKER = 'ClaudeResetNotifier';

function normalizeUsageResponse(raw: unknown): { fiveHour: { utilization: number; resetsAtMs: number | null } | null } {
  if (!raw || typeof raw !== 'object') return { fiveHour: null };
  const obj = raw as Record<string, unknown>;
  const fiveHourRaw = obj.five_hour;

  if (!fiveHourRaw || typeof fiveHourRaw !== 'object') return { fiveHour: null };
  const w = fiveHourRaw as Record<string, unknown>;

  if (typeof w.utilization !== 'number' || !Number.isFinite(w.utilization)) {
    return { fiveHour: null };
  }

  const utilization = Math.max(0, Math.min(100, w.utilization));
  const resetsAtMs =
    typeof w.resets_at === 'string' && w.resets_at.length > 0
      ? Date.parse(w.resets_at) || null
      : null;

  return { fiveHour: { utilization, resetsAtMs } };
}

window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  const data = event.data as { crn?: string; type?: string; requestId?: string; orgId?: string };

  if (!data || data.crn !== BRIDGE_MARKER || data.type !== 'crn:request-usage') return;

  const { requestId, orgId } = data;
  if (!requestId || !orgId) return;

  try {
    const res = await window.fetch(
      `https://claude.ai/api/organizations/${orgId}/usage`,
      { method: 'GET', credentials: 'include' },
    );

    if (!res.ok) {
      throw new Error(`GET /usage responded with status ${res.status}`);
    }

    const json = await res.json();
    const normalized = normalizeUsageResponse(json);

    window.postMessage(
      {
        crn: BRIDGE_MARKER,
        type: 'crn:usage-response',
        requestId,
        ok: true,
        payload: normalized,
        error: null,
      },
      '*',
    );
  } catch (err) {
    window.postMessage(
      {
        crn: BRIDGE_MARKER,
        type: 'crn:usage-response',
        requestId,
        ok: false,
        payload: null,
        error: err instanceof Error ? err.message : String(err),
      },
      '*',
    );
  }
});
