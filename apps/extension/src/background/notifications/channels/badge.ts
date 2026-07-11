import type { NotificationChannel } from '../types';

/**
 * Sets a badge on the extension icon as a persistent visual cue. Cleared
 * when the popup opens (see popup/Popup.tsx) or when Mark as Seen is clicked.
 * Holds no state of its own beyond what chrome.action already tracks.
 */
export const badgeNotifier: NotificationChannel = {
  id: 'badge',

  isEnabled(prefs) {
    return prefs.channels.badge;
  },

  async notify() {
    await chrome.action.setBadgeText({ text: '1' });
    await chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
  },
};
