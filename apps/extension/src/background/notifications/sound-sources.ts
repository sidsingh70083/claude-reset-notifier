import type { SoundSource } from '@claude-reset/shared';
import { BUILTIN_SOUND_IDS, BUILTIN_SOUND_LABELS, type BuiltinSoundId } from '@claude-reset/shared';

/**
 * Single registry of built-in sounds. Adding a new one means:
 *   1. Add the ID to BUILTIN_SOUND_IDS in shared/constants.ts
 *   2. Add its label to BUILTIN_SOUND_LABELS
 *   3. Drop the audio file at public/sounds/{id}.wav
 * Nothing else in the codebase needs to change — SoundNotifier and the
 * Options page both read from this list, never a hardcoded name.
 */
export function listBuiltinSounds(): SoundSource[] {
  return BUILTIN_SOUND_IDS.map((id) => ({
    id,
    name: BUILTIN_SOUND_LABELS[id],
    kind: 'builtin' as const,
  }));
}

/**
 * Resolves a sound ID to a playable URL.
 *
 * Built-in: chrome.runtime.getURL to the bundled file in public/sounds/.
 * Custom (future): NOT implemented yet — this is the one function that will
 * need a branch added when upload support ships. It will look up the sound's
 * blob in IndexedDB (see notes below) and return an Object URL created from it.
 *
 * IMPLEMENTATION NOTE FOR FUTURE CUSTOM UPLOAD SUPPORT:
 *   chrome.storage.local has a small total quota (~10MB) — not suitable for
 *   audio blobs. Store uploaded files in IndexedDB instead (a dedicated
 *   'customSounds' object store, keyed by a generated ID), and have this
 *   function do:
 *     const blob = await getCustomSoundBlob(soundId);
 *     return URL.createObjectURL(blob);
 *   Remember to revoke the Object URL after playback to avoid leaking memory
 *   (offscreen.ts should call URL.revokeObjectURL once the <audio> 'ended'
 *   event fires, only for custom sounds — builtin URLs are static and never
 *   need revoking).
 */
export function resolveSoundUrl(soundId: string): string {
  if ((BUILTIN_SOUND_IDS as readonly string[]).includes(soundId)) {
    return chrome.runtime.getURL(`sounds/${soundId as BuiltinSoundId}.wav`);
  }

  // Not a recognized built-in ID and custom upload isn't implemented yet —
  // fall back to 'default' rather than returning an invalid URL.
  console.warn(`[Claude Reset] Unknown sound ID "${soundId}", falling back to default`);
  return chrome.runtime.getURL('sounds/default.wav');
}
