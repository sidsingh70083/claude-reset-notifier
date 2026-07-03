/**
 * Claude Reset Notifier — Notification Dispatcher
 * Milestone 8
 *
 * Runs every 25 minutes via GitHub Actions (see .github/workflows/dispatcher.yml).
 * Queries Firestore for sessions whose resetTime has passed and haven't been
 * notified yet, sends an FCM Web Push to each user's registered phone, and
 * marks the session as notified.
 *
 * Why 25 minutes?
 *   Private GitHub repos get 2,000 free Actions minutes/month. Each run
 *   costs ~1 billed minute. At 25-minute intervals: 57.6 runs/day ×
 *   1 min × 30 days = 1,728 min/month — safely under the free limit.
 *   (Public repos have unlimited minutes and can use shorter intervals.)
 *
 * ── TO IMPLEMENT (Milestone 8) ──────────────────────────────────────────────
 *
 * 1. Initialize firebase-admin with the service account stored in
 *    the FIREBASE_SERVICE_ACCOUNT GitHub Actions secret.
 *
 * 2. Query Firestore:
 *      collection-group query on session/current where
 *        resetTime <= Date.now() AND notified == false
 *    This requires a Firestore composite index — add it to
 *    firebase/firestore.indexes.json and deploy with `firebase deploy --only firestore:indexes`.
 *
 * 3. For each matching session:
 *    a. Load the user's pushSubscriptions subcollection to get FCM tokens.
 *    b. Send a push via admin.messaging().sendEachForMulticast({...}).
 *    c. On success: set session.notified = true in Firestore.
 *    d. On token error (registration-token-not-registered):
 *       delete the stale token from pushSubscriptions.
 *
 * 4. Log the results (GitHub Actions captures stdout as job output).
 *
 * ────────────────────────────────────────────────────────────────────────────
 */

// TODO M8: Remove this stub and implement the above

console.log('[Dispatcher] Stub — implement in Milestone 8.');
console.log('[Dispatcher] Run timestamp:', new Date().toISOString());
