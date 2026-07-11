import type { NotificationChannel } from '../types';
import type { ResetNotificationEvent } from '@claude-reset/shared';

/**
 * ROOT CAUSE FIX: the old implementation used a single static ID for every
 * notification. Chrome's contract for chrome.notifications.create() is that
 * calling it again with an existing ID *updates* that notification in place
 * rather than creating a new one — and on Windows, updating an already
 * present-but-undismissed toast frequently does not re-trigger the visible
 * banner or sound. Reusing one ID forever caused every notification after
 * the first undismissed one to silently no-op from the user's perspective.
 *
 * Fix: generate a fresh, unique ID every time, and explicitly clear the
 * previous one first. This ID-tracking state belongs here, inside this
 * channel — not as a shared constant, and not inside NotificationManager.
 * It's persisted to chrome.storage.local so it survives service worker
 * restarts (a module-level variable alone would not).
 */

const LAST_ID_STORAGE_KEY = 'crn:lastDesktopNotificationId';
const ID_PREFIX = 'claude-reset-notification';

async function getLastNotificationId(): Promise<string | null> {
  const result = await chrome.storage.local.get(LAST_ID_STORAGE_KEY);
  return (result[LAST_ID_STORAGE_KEY] as string) ?? null;
}

async function setLastNotificationId(id: string): Promise<void> {
  await chrome.storage.local.set({ [LAST_ID_STORAGE_KEY]: id });
}

/** Used by background/index.ts's onClicked handler to recognize our notifications regardless of the dynamic suffix. */
export function isOurNotificationId(id: string): boolean {
  return id.startsWith(ID_PREFIX);
}

export const desktopNotifier: NotificationChannel = {
  id: 'desktop',

  isEnabled(prefs) {
    return prefs.channels.desktop;
  },

  async notify(event: ResetNotificationEvent) {
    const previousId = await getLastNotificationId();
    if (previousId) {
      // Explicitly clear before creating a new one — this is what actually
      // fixes the "lingering notification blocks the next one" bug, rather
      // than hoping an ID reuse silently "just works" on every platform.
      chrome.notifications.clear(previousId);
    }

    const newId = `${ID_PREFIX}-${Date.now()}`;

    const title = event.kind === 'reminder' ? '⏰ Still waiting on Claude' : '✅ Claude is ready';
    const message =
      event.kind === 'reminder'
        ? 'Your session reset a little while ago. Click to open Claude.'
        : 'Your session has reset. Click to open Claude.';

    await chrome.notifications.create(newId, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message,
      priority: 2,
      requireInteraction: false,
    });

    await setLastNotificationId(newId);
  },
};
