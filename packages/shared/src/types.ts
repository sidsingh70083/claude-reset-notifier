/**
 * Shared TypeScript types across extension, companion PWA, and dispatcher.
 * If you change the shape of Session, update Firestore and storage reads in
 * the same PR — these three surfaces share one schema.
 */

import type { BuiltinSoundId, ReminderMode } from './constants';

export interface Session {
  /** Unix timestamp in ms — when the first prompt was sent.
   *  When resetTime is sourced from GET /usage, this is BACK-COMPUTED
   *  (resetTime - RESET_WINDOW_MS) purely for display purposes in the popup.
   *  It is NOT authoritative in that case — resetTime is. */
  sessionStart: number;
  /** Unix timestamp in ms — when Claude becomes available again.
   *  Authoritative when sourced from GET /usage (source: 'usage-endpoint').
   *  Estimated when sourced from local DOM/network detection (source: 'local-estimate'). */
  resetTime: number;
  /** True once the initial desktop and/or phone notifications have been sent */
  notified: boolean;
  /** Where resetTime came from. Determines how much we trust it. */
  source: 'usage-endpoint' | 'local-estimate';
}

export interface StoredUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export interface RemoteConfig {
  /** Override the default 5-hour window from Firestore config/global */
  resetWindowMs: number;
}

export interface PushSubscription {
  fcmToken: string;
  createdAt: number;
  lastSeen: number;
}

/**
 * Parsed, normalized response from GET /api/organizations/{orgId}/usage.
 * Only the five_hour window matters for this product — seven_day is fetched
 * as part of the same response but intentionally unused (see PRD non-goals:
 * no analytics, no usage bars — we only need resets_at for accurate timing).
 */
export interface UsageWindow {
  /** 0-100 */
  utilization: number;
  /** Unix ms. Null if Anthropic omitted it (no active session on their side). */
  resetsAtMs: number | null;
}

export interface UsageResponse {
  fiveHour: UsageWindow | null;
}

// ── Notification architecture ─────────────────────────────────────────────────

/**
 * The single event object passed to NotificationManager.notifyReset().
 * Every channel receives the same event — this is what lets a channel vary
 * its copy (e.g. "Claude is ready" vs "Still waiting on Claude") without any
 * channel needing to know about session/reminder internals directly.
 */
export interface ResetNotificationEvent {
  kind: 'initial' | 'reminder';
  resetTime: number;
  utilization: number | null;
}

export interface NotificationPreferences {
  channels: {
    badge: boolean;
    toast: boolean;
    desktop: boolean;
    sound: boolean;
  };
  sound: {
    enabled: boolean;
    soundId: BuiltinSoundId | string; // string allows future custom sound IDs
    volumeMode: 'system' | 'extension';
    volumePercent: number; // 0-100, only used when volumeMode === 'extension'
  };
  reminder: {
    mode: ReminderMode;
  };
}

/**
 * A playable sound, built-in or (later) user-uploaded. SoundNotifier only
 * ever depends on this interface — never on hardcoded sound names.
 */
export interface SoundSource {
  id: string;
  name: string;
  kind: 'builtin' | 'custom';
}

/** Messages sent from content script → background service worker */
export type ContentMessage =
  | { type: 'SESSION_PROMPT_DETECTED'; timestamp: number; source: 'dom' | 'network' }
  | {
      type: 'SESSION_RECOVERY';
      hasExistingMessages: boolean;
      /** null when messages were found but no machine-readable timestamp was available */
      estimatedStart: number | null;
    }
  | {
      /** Authoritative timing data from GET /usage. Always preferred over local estimates. */
      type: 'USAGE_UPDATE';
      resetsAtMs: number | null;
      utilization: number | null;
    }
  | { type: 'SIGN_OUT' }
  | { type: 'MARK_AS_SEEN' }
  | { type: 'TEST_SOUND'; soundId: string };

export type ContentMessageResponse = { ok: boolean };

/** Bridge protocol between the isolated-world content script and the MAIN-world injected script. */
export interface UsageBridgeRequest {
  crn: 'ClaudeResetNotifier';
  type: 'crn:request-usage';
  requestId: string;
  orgId: string;
}

export interface UsageBridgeResponse {
  crn: 'ClaudeResetNotifier';
  type: 'crn:usage-response';
  requestId: string;
  ok: boolean;
  payload: UsageResponse | null;
  error: string | null;
}
