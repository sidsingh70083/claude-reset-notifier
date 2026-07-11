import type { PlaySoundMessage } from './offscreen-protocol';

const OFFSCREEN_DOCUMENT_PATH = 'src/offscreen/offscreen.html';

async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  return contexts.length > 0;
}

let creatingPromise: Promise<void> | null = null;

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;

  // Guard against a race where two calls both see "doesn't exist" and both
  // try to create it — chrome.offscreen.createDocument throws if called
  // twice concurrently for the same document.
  if (creatingPromise) {
    await creatingPromise;
    return;
  }

  creatingPromise = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: 'Play notification sound independently of any visible tab or popup',
    })
    .finally(() => {
      creatingPromise = null;
    });

  await creatingPromise;
}

/**
 * Sends a play-sound request to the offscreen document, creating it first
 * if needed. This is the only function SoundNotifier calls — it never talks
 * to chrome.offscreen directly.
 *
 * Failures here (offscreen creation fails, message delivery fails) are
 * caught by the caller (SoundNotifier) — this function intentionally lets
 * errors propagate rather than swallowing them, so SoundNotifier's own
 * try/catch is the single place sound failures are handled and logged.
 */
export async function playSoundViaOffscreen(
  url: string,
  volumeMode: 'system' | 'extension',
  volumePercent: number,
): Promise<void> {
  await ensureOffscreenDocument();

  const message: PlaySoundMessage = {
    target: 'crn-offscreen',
    type: 'PLAY_SOUND',
    url,
    volumeMode,
    volumePercent,
  };

  await chrome.runtime.sendMessage(message);
}
