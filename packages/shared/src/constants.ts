/** Default reset window = 5 hours. Overridable via Firestore config/global (Milestone 5). */
export const RESET_WINDOW_MS = 5 * 60 * 60 * 1_000;

/** Firestore document paths. Single place to update if schema changes. */
export const FIRESTORE_PATHS = {
  user: (uid: string) => `users/${uid}`,
  session: (uid: string) => `users/${uid}/session/current`,
  pushSubscriptions: (uid: string) => `users/${uid}/pushSubscriptions`,
  globalConfig: 'config/global',
} as const;

/**
 * Firestore collection GROUP names — distinct from FIRESTORE_PATHS above,
 * which builds full per-user document paths. A collection group query
 * matches a subcollection name across every parent document (e.g. every
 * user's session subcollection at once), so it needs just the bare name,
 * not a uid-scoped path. Used by the dispatcher's cross-user query.
 */
export const FIRESTORE_COLLECTION_GROUPS = {
  session: 'session',
} as const;

/** chrome.storage.local keys */
export const STORAGE_KEYS = {
  session: 'session',
  user: 'user',
  resetWindowMs: 'resetWindowMs',
  /** True when recovery scan found messages but could not extract a start timestamp. */
  midSessionDetected: 'midSessionDetected',
  /** NotificationPreferences — local only, per architecture decision. */
  notificationPreferences: 'notificationPreferences',
} as const;

/** Named alarm for the initial reset notification — survives service worker termination */
export const ALARM_NAME = 'claude-reset-alarm';

/** Named alarm for recurring reminders — separate from ALARM_NAME so the two lifecycles never interfere */
export const REMINDER_ALARM_NAME = 'claude-reset-reminder-alarm';

/**
 * Debounce window for prompt detection.
 * DOM signal and network signal can fire within ms of each other for the
 * same prompt — this prevents double-counting them as two separate sessions.
 */
export const SESSION_START_DEBOUNCE_MS = 5_000;

/**
 * Built-in sound IDs — the single source of truth for what sounds exist.
 * SoundNotifier and the Options page both read from this list; adding a new
 * built-in sound means adding one entry here plus one bundled audio file,
 * nothing else changes.
 */
export const BUILTIN_SOUND_IDS = ['default', 'chime', 'bell', 'digital'] as const;
export type BuiltinSoundId = (typeof BUILTIN_SOUND_IDS)[number];

export const BUILTIN_SOUND_LABELS: Record<BuiltinSoundId, string> = {
  default: 'Default',
  chime: 'Chime',
  bell: 'Bell',
  digital: 'Digital',
};

export const REMINDER_INTERVALS_MINUTES = [5, 10, 15, 30, 60] as const;
export type ReminderIntervalMinutes = (typeof REMINDER_INTERVALS_MINUTES)[number];
export type ReminderMode = 'disabled' | ReminderIntervalMinutes;

/** Default preferences applied on first install, before the user changes anything. */
export const DEFAULT_NOTIFICATION_PREFERENCES = {
  channels: {
    badge: true,
    toast: true,
    desktop: true,
    sound: true,
  },
  sound: {
    enabled: true,
    soundId: 'default' as BuiltinSoundId | string,
    volumeMode: 'system' as 'system' | 'extension',
    volumePercent: 75,
  },
  reminder: {
    mode: 'disabled' as ReminderMode,
  },
};
