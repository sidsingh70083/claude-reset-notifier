import type { ResetNotificationEvent, NotificationPreferences } from '@claude-reset/shared';

/**
 * Every notification channel implements this and nothing else. A channel
 * must never import or call another channel — if two channels need shared
 * logic, that logic belongs in a shared utility, not in one channel calling
 * another.
 */
export interface NotificationChannel {
  id: string;
  isEnabled(prefs: NotificationPreferences): boolean;
  notify(event: ResetNotificationEvent, prefs: NotificationPreferences): Promise<void>;
}
