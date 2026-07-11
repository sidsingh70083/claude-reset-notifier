/**
 * Protocol for background service worker ↔ offscreen document communication.
 * Kept separate from ContentMessage (shared/types.ts) since that union is
 * specifically for content-script → background messages — a different
 * channel with different senders/receivers.
 */

export interface PlaySoundMessage {
  target: 'crn-offscreen';
  type: 'PLAY_SOUND';
  url: string;
  volumeMode: 'system' | 'extension';
  volumePercent: number; // 0-100, only applied when volumeMode === 'extension'
}

export function isPlaySoundMessage(msg: unknown): msg is PlaySoundMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { target?: string }).target === 'crn-offscreen' &&
    (msg as { type?: string }).type === 'PLAY_SOUND'
  );
}
