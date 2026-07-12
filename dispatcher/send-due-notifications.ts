/**
 * Claude Reset Notifier — Notification Dispatcher (Milestone 8, real implementation)
 *
 * Runs every 25 minutes via GitHub Actions (.github/workflows/dispatcher.yml).
 * Queries Firestore for sessions whose resetTime has passed and haven't been
 * notified yet, sends an FCM push to each user's registered phone(s), and
 * marks the session as notified.
 *
 * ── Query strategy ───────────────────────────────────────────────────────────
 * Uses a Firestore COLLECTION GROUP query on 'session' (matches every user's
 * users/{uid}/session/current doc regardless of parent). Filters only on
 * resetTime <= now server-side; the notified === false check happens in code
 * after fetching, rather than as a second Firestore filter. This avoids
 * requiring a composite index for now — at the expected scale (a handful of
 * users), fetching all overdue-timestamp sessions and filtering in memory is
 * simpler than maintaining a composite index, and correctness is identical.
 * If this ever needs to scale to many users, add `where('notified', '==', false)`
 * back as a second filter and create the matching composite index.
 *
 * Collection group queries DO require an index for the field used in the
 * range filter (resetTime) — see firestore.indexes.json. This was hand-authored
 * based on Firestore's documented index schema, not verified against a live
 * project from this environment. If the query fails at runtime, Firestore's
 * own error message includes a direct link to auto-create the exact index
 * needed — that link is the most reliable fallback if the hand-authored
 * config below doesn't match exactly.
 *
 * ── Admin SDK bypasses security rules ────────────────────────────────────────
 * firestore.rules restricts client access to each user's own data — that's
 * irrelevant here. The Admin SDK, authenticated via a service account,
 * bypasses security rules entirely by design, which is exactly what lets
 * this script read/write across all users from a trusted server context.
 */

import { initializeApp, cert, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { FIRESTORE_PATHS, FIRESTORE_COLLECTION_GROUPS } from '@claude-reset/shared';

function loadServiceAccount(): ServiceAccount {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT environment variable is not set');
  }
  return JSON.parse(raw) as ServiceAccount;
}

const app = initializeApp({ credential: cert(loadServiceAccount()) });
const db = getFirestore(app);
const messaging = getMessaging(app);

interface DueSession {
  uid: string;
  sessionDocPath: string;
  resetTime: number;
}

async function findDueSessions(): Promise<DueSession[]> {
  const now = Date.now();

  const snapshot = await db
    .collectionGroup(FIRESTORE_COLLECTION_GROUPS.session)
    .where('resetTime', '<=', now)
    .get();

  const due: DueSession[] = [];

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    if (data.notified === true) continue; // already handled, filtered in-memory (see header note)

    // docSnap.ref is users/{uid}/session/current — parent.parent is the users/{uid} doc
    const uid = docSnap.ref.parent.parent?.id;
    if (!uid) continue; // structurally shouldn't happen given our schema, but guard anyway

    due.push({ uid, sessionDocPath: docSnap.ref.path, resetTime: data.resetTime });
  }

  return due;
}

async function getTokensForUser(uid: string): Promise<string[]> {
  const snapshot = await db.collection(FIRESTORE_PATHS.pushSubscriptions(uid)).get();
  return snapshot.docs
    .map((d) => d.data().fcmToken as string)
    .filter((token): token is string => typeof token === 'string' && token.length > 0);
}

async function deleteStaleToken(uid: string, token: string): Promise<void> {
  await db.doc(`${FIRESTORE_PATHS.pushSubscriptions(uid)}/${token}`).delete();
}

async function markNotified(sessionDocPath: string): Promise<void> {
  await db.doc(sessionDocPath).set({ notified: true }, { merge: true });
}

const STALE_TOKEN_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

async function sendToUser(session: DueSession): Promise<void> {
  const tokens = await getTokensForUser(session.uid);

  if (tokens.length === 0) {
    console.log(`[Dispatcher] User ${session.uid} has no registered phone — skipping push, session unmarked`);
    // Deliberately NOT marking as notified — desktop notification already
    // covered this session; if the user later registers a phone, we don't
    // want to have silently given up on ever notifying them there. The next
    // dispatcher run will just see the same due session again and retry,
    // which is harmless since sending to zero tokens is a no-op either way.
    return;
  }

  const response = await messaging.sendEachForMulticast({
    tokens,
    notification: {
      title: '✅ Claude is ready',
      body: 'Your session has reset. Tap to open Claude.',
    },
    webpush: {
      fcmOptions: { link: 'https://claude.ai' },
    },
  });

  console.log(
    `[Dispatcher] User ${session.uid}: ${response.successCount}/${tokens.length} pushes delivered`,
  );

  // Clean up any tokens FCM says are permanently invalid, so future runs
  // don't keep retrying a dead device registration.
  await Promise.all(
    response.responses.map(async (result, i) => {
      if (!result.success && result.error && STALE_TOKEN_ERROR_CODES.has(result.error.code)) {
        console.log(`[Dispatcher] Removing stale token for user ${session.uid}`);
        await deleteStaleToken(session.uid, tokens[i]);
      }
    }),
  );

  if (response.successCount > 0) {
    await markNotified(session.sessionDocPath);
  }
}

async function main(): Promise<void> {
  console.log('[Dispatcher] Run started:', new Date().toISOString());

  const due = await findDueSessions();
  console.log(`[Dispatcher] Found ${due.length} due session(s)`);

  for (const session of due) {
    try {
      await sendToUser(session);
    } catch (err) {
      // One user's failure must never stop the rest of the batch.
      console.error(`[Dispatcher] Failed to process user ${session.uid}:`, err);
    }
  }

  console.log('[Dispatcher] Run complete');
}

main().catch((err) => {
  console.error('[Dispatcher] Fatal error:', err);
  process.exit(1);
});
