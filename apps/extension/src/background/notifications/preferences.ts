import type { NotificationPreferences } from '@claude-reset/shared';
import { STORAGE_KEYS, DEFAULT_NOTIFICATION_PREFERENCES } from '@claude-reset/shared';

/**
 * Deep-merges stored preferences over the defaults. This matters because
 * new preference fields will be added over time (e.g. Android settings in a
 * future milestone) — an existing install's storage won't have those keys,
 * and a shallow merge or a bare "return stored ?? default" would silently
 * produce `undefined` for any newly-added nested field.
 */
function mergeWithDefaults(stored: Partial<NotificationPreferences> | undefined): NotificationPreferences {
  const d = DEFAULT_NOTIFICATION_PREFERENCES;
  return {
    channels: { ...d.channels, ...stored?.channels },
    sound: { ...d.sound, ...stored?.sound },
    reminder: { ...d.reminder, ...stored?.reminder },
  };
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.notificationPreferences);
  const stored = result[STORAGE_KEYS.notificationPreferences] as
    | Partial<NotificationPreferences>
    | undefined;
  return mergeWithDefaults(stored);
}

export async function setNotificationPreferences(prefs: NotificationPreferences): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.notificationPreferences]: prefs });
}

/** Convenience for the Options page — patch just one section without needing the full object. */
export async function updateNotificationPreferences(
  patch: Partial<NotificationPreferences>,
): Promise<NotificationPreferences> {
  const current = await getNotificationPreferences();
  const updated: NotificationPreferences = {
    channels: { ...current.channels, ...patch.channels },
    sound: { ...current.sound, ...patch.sound },
    reminder: { ...current.reminder, ...patch.reminder },
  };
  await setNotificationPreferences(updated);
  return updated;
}
