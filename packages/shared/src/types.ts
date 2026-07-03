/**
 * Shared TypeScript types across extension, companion PWA, and dispatcher.
 * If you change the shape of Session, update Firestore and storage reads in
 * the same PR — these three surfaces share one schema.
 */

export interface Session {
  /** Unix timestamp in ms — when the first prompt was sent */
  sessionStart: number;
  /** Unix timestamp in ms — when Claude becomes available again */
  resetTime: number;
  /** True once desktop and/or phone notifications have been sent */
  notified: boolean;
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

/** Messages sent from content script → background service worker */
export type ContentMessage =
  | { type: 'SESSION_PROMPT_DETECTED'; timestamp: number; source: 'dom' | 'network' }
  | { type: 'SIGN_OUT' };

export type ContentMessageResponse = { ok: boolean };
