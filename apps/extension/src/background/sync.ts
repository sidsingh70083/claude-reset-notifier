/**
 * Firestore Sync — Milestone 5
 *
 * These are intentional no-op stubs. The extension works fully without them
 * for M1–M3 (local session tracking + desktop notifications). Phone notifications
 * require Firestore sync, which lands in M5.
 *
 * When implementing M5:
 *   - Replace syncSessionToFirestore with a real Firestore write to
 *     users/{uid}/session/current
 *   - Replace fetchRemoteResetWindow with a read from config/global
 *   - Import firebase/firestore using the app instance from ../lib/firebase
 *   - Note: Firestore persistence is NOT available in service workers — call
 *     initializeFirestore(app, { localCache: memoryLocalCache() }) instead
 *     of getFirestore() to avoid IndexedDB errors.
 */

import type { Session, StoredUser } from '@claude-reset/shared';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function syncSessionToFirestore(_session: Session, _user: StoredUser): Promise<void> {
  // TODO M5: write session to Firestore
  return;
}

export async function fetchRemoteResetWindow(): Promise<number | null> {
  // TODO M5: read config/global.resetWindowMs from Firestore
  return null;
}
