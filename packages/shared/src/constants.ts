/** Default reset window = 5 hours. Overridable via Firestore config/global (Milestone 5). */
export const RESET_WINDOW_MS = 5 * 60 * 60 * 1_000;

/** Firestore document paths. Single place to update if schema changes. */
export const FIRESTORE_PATHS = {
  user: (uid: string) => `users/${uid}`,
  session: (uid: string) => `users/${uid}/session/current`,
  pushSubscriptions: (uid: string) => `users/${uid}/pushSubscriptions`,
  globalConfig: 'config/global',
} as const;

/** chrome.storage.local keys */
export const STORAGE_KEYS = {
  session: 'session',
  user: 'user',
  resetWindowMs: 'resetWindowMs',
} as const;

/** Named alarm — survives service worker termination */
export const ALARM_NAME = 'claude-reset-alarm';

/** Notification ID — stable so we can replace/clear it */
export const NOTIFICATION_ID = 'claude-reset-notification';

/**
 * Debounce window for prompt detection.
 * DOM signal and network signal can fire within ms of each other for the
 * same prompt — this prevents double-counting them as two separate sessions.
 */
export const SESSION_START_DEBOUNCE_MS = 5_000;
