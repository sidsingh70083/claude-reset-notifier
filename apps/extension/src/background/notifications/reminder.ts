import { REMINDER_ALARM_NAME } from '@claude-reset/shared';
import { getNotificationPreferences } from './preferences';

/**
 * Starts recurring reminders after the initial notification has fired.
 * No-op if the user has reminders disabled. Uses a dedicated alarm name
 * (REMINDER_ALARM_NAME, distinct from ALARM_NAME) so starting, stopping, or
 * misfiring a reminder can never affect the one-shot initial-reset alarm.
 */
export async function startReminders(): Promise<void> {
  const prefs = await getNotificationPreferences();
  const mode = prefs.reminder.mode;

  if (mode === 'disabled') return;

  chrome.alarms.create(REMINDER_ALARM_NAME, { periodInMinutes: mode });
}

/**
 * Stops any active reminder cycle. Safe to call unconditionally — clearing
 * a non-existent alarm is a harmless no-op. Called from every stop condition:
 * a new session starting, the user opening Claude, dismissing a notification,
 * or clicking "Mark as Seen" in the popup.
 */
export function stopReminders(): void {
  chrome.alarms.clear(REMINDER_ALARM_NAME);
}
