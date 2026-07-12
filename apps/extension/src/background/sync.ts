/**
 * Firestore Sync — Milestone 5 (real implementation)
 *
 * Two responsibilities:
 *   1. Write the current session to users/{uid}/session/current on every
 *      change (called from background/index.ts after applyAuthoritativeUsage
 *      or handleLocalEstimate produce a new/updated session).
 *   2. Read config/global.resetWindowMs once per service worker lifetime and
 *      cache it locally via setResetWindowMs — this only matters for the
 *      FALLBACK (local-estimate) path now; when GET /usage succeeds, the
 *      resetTime is authoritative from Anthropic directly and doesn't use
 *      this value at all. See background/session.ts.
 *
 * Firestore in a service worker — verified, not assumed:
 *   initializeFirestore(app, settings) throws if called more than once per
 *   JS realm ("Can only be called before any other function, including
 *   getFirestore" — confirmed directly from @firebase/firestore's type
 *   definitions). A service worker's module scope re-evaluates from scratch
 *   every time the browser restarts it after idling out, so this file uses
 *   the same defensive singleton pattern as lib/firebase.ts's firebaseApp.
 *
 *   Explicitly requesting memoryLocalCache() (rather than the persistent/
 *   IndexedDB cache) is intentional, not just defensive: persistent cache's
 *   tab manager coordinates across multiple tabs of the same origin using
 *   assumptions (a stable `window`, visibility events) that don't hold in a
 *   service worker. We don't need offline reads of Firestore data anyway —
 *   chrome.storage.local already serves as this extension's local/offline
 *   cache (see lib/storage.ts) — so memory-only cache has no downside here.
 *
 * Retry strategy:
 *   No dedicated retry queue. A failed write is logged and dropped — the
 *   next natural trigger (next detected prompt, next GET /usage refresh,
 *   next reminder tick) calls this function again anyway, so a transient
 *   failure self-heals on the next normal event rather than needing its
 *   own exponential-backoff machinery. This matches the existing
 *   fire-and-forget `.catch(console.error)` pattern already used at every
 *   call site in background/index.ts.
 */

import {
  initializeFirestore,
  getFirestore,
  memoryLocalCache,
  doc,
  setDoc,
  getDoc,
  type Firestore,
} from 'firebase/firestore';
import { firebaseApp } from '../lib/firebase';
import { setResetWindowMs } from '../lib/storage';
import { FIRESTORE_PATHS } from '@claude-reset/shared';
import type { Session, StoredUser } from '@claude-reset/shared';

function getDb(): Firestore {
  try {
    return initializeFirestore(firebaseApp, { localCache: memoryLocalCache() });
  } catch {
    // Already initialized in this realm — reuse the existing instance rather
    // than throwing. Mirrors the getApps()/getApp() guard in lib/firebase.ts.
    return getFirestore(firebaseApp);
  }
}

/**
 * Writes the current session to Firestore. Uses merge:true rather than a
 * blind overwrite so a future field written by something else (e.g. the
 * GitHub Actions dispatcher marking server-side delivery state once M8 is
 * implemented) is never clobbered by a client-side write that doesn't know
 * about it.
 *
 * Fire-and-forget by design — see "Retry strategy" above. Callers already
 * wrap this in .catch(console.error); this function does not re-throw.
 */
export async function syncSessionToFirestore(session: Session, user: StoredUser): Promise<void> {
  const db = getDb();
  const ref = doc(db, FIRESTORE_PATHS.session(user.uid));

  await setDoc(
    ref,
    {
      sessionStart: session.sessionStart,
      resetTime: session.resetTime,
      notified: session.notified,
      source: session.source,
      updatedAt: Date.now(),
    },
    { merge: true },
  );
}

/**
 * Reads config/global.resetWindowMs from Firestore and caches it locally
 * via setResetWindowMs, so every existing call to getResetWindowMs()
 * (lib/storage.ts) transparently picks up the remote value with zero
 * changes anywhere else. Returns the value for callers that want it
 * immediately without a second read from local storage.
 *
 * Returns null on any failure (no config doc yet, malformed field, offline,
 * permission error) — callers should treat null as "keep using whatever is
 * already cached locally," never as an error to surface to the user. The
 * hardcoded RESET_WINDOW_MS default in shared/constants.ts remains the
 * ultimate fallback if this has never succeeded even once.
 */
export async function fetchRemoteResetWindow(): Promise<number | null> {
  try {
    const db = getDb();
    const ref = doc(db, FIRESTORE_PATHS.globalConfig);
    const snapshot = await getDoc(ref);

    if (!snapshot.exists()) return null;

    const data = snapshot.data();
    const value = data?.resetWindowMs;

    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return null;
    }

    await setResetWindowMs(value);
    return value;
  } catch (err) {
    console.warn('[Claude Reset] fetchRemoteResetWindow failed, using local/default value:', err);
    return null;
  }
}
