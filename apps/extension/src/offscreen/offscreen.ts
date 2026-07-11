/**
 * Runs inside the offscreen document (chrome-extension:// origin).
 *
 * WHY THIS FIXES THE AUTOPLAY BUG:
 *   The old implementation created an AudioContext inside a script injected
 *   via chrome.scripting.executeScript into the claude.ai tab. That's page
 *   content from the browser's perspective, subject to Chrome's autoplay
 *   policy — playback can silently start "suspended" with no error and no
 *   audible output, because there's no user gesture in that call stack.
 *
 *   An offscreen document is a first-party extension page, never visible,
 *   created explicitly for exactly this situation. Chrome's offscreen API
 *   documents 'AUDIO_PLAYBACK' as a supported reason specifically because
 *   MV3 service workers can't play audio directly. Playback here does not
 *   depend on the claude.ai tab existing, being focused, or the popup being
 *   open — satisfying the independence requirement for SoundNotifier.
 *
 * Survives service worker restarts: once created, an offscreen document
 * persists independently of the service worker's lifecycle. It only closes
 * when explicitly closed (chrome.offscreen.closeDocument) or the browser
 * fully shuts down.
 */

import { isPlaySoundMessage } from '../background/notifications/offscreen-protocol';

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (!isPlaySoundMessage(message)) return false;

  const audio = new Audio(message.url);
  audio.volume =
    message.volumeMode === 'extension'
      ? Math.max(0, Math.min(1, message.volumePercent / 100))
      : 1; // 'system' mode: play at full element volume, let the OS mixer control loudness

  audio.play().catch((err) => {
    // Playback can still fail for reasons unrelated to autoplay policy
    // (e.g. the sound file is missing or corrupt) — log, don't throw,
    // so a failed sound never affects any other notification channel.
    console.warn('[Claude Reset] Offscreen sound playback failed:', err);
  });

  return false; // synchronous handling, no async response expected
});
