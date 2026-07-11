import type { NotificationChannel } from '../types';
import { resolveSoundUrl } from '../sound-sources';
import { playSoundViaOffscreen } from '../offscreen-manager';

export const soundNotifier: NotificationChannel = {
  id: 'sound',

  isEnabled(prefs) {
    return prefs.channels.sound && prefs.sound.enabled;
  },

  async notify(_event, prefs) {
    const url = resolveSoundUrl(prefs.sound.soundId);
    await playSoundViaOffscreen(url, prefs.sound.volumeMode, prefs.sound.volumePercent);
  },
};
