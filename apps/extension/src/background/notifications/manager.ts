import type { ResetNotificationEvent } from '@claude-reset/shared';
import type { NotificationChannel } from './types';
import { getNotificationPreferences } from './preferences';
import { badgeNotifier } from './channels/badge';
import { toastNotifier } from './channels/toast';
import { desktopNotifier } from './channels/desktop';
import { soundNotifier } from './channels/sound';

/**
 * Registered channels. Adding a new one (Discord, Slack, webhook, and
 * eventually a real Android sync channel) means writing one object that
 * implements NotificationChannel and adding it to this array — nothing
 * else in this file, or in any existing channel, needs to change.
 */
const CHANNELS: NotificationChannel[] = [badgeNotifier, toastNotifier, desktopNotifier, soundNotifier];

/**
 * Single entry point for all notifications. Contains no notification logic
 * itself — only loads preferences once, filters to enabled channels, and
 * fans out via Promise.allSettled so that:
 *   - every channel always attempts to run, regardless of any other channel's outcome
 *   - one channel's failure/rejection never prevents another from executing
 *   - no channel can observe or depend on another's success or failure
 */
export async function notifyReset(event: ResetNotificationEvent): Promise<void> {
  const prefs = await getNotificationPreferences();
  const enabledChannels = CHANNELS.filter((channel) => channel.isEnabled(prefs));

  const results = await Promise.allSettled(
    enabledChannels.map((channel) => channel.notify(event, prefs)),
  );

  results.forEach((result, i) => {
    const channelId = enabledChannels[i].id;
    if (result.status === 'rejected') {
      console.warn(`[Claude Reset] Notification channel "${channelId}" failed:`, result.reason);
    } else {
      console.log(`[Claude Reset] Notification channel "${channelId}" completed`);
    }
  });
}
