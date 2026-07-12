import { getToken } from 'firebase/messaging';
import { doc, setDoc, getFirestore } from 'firebase/firestore';
import { firebaseApp, getMessagingInstance } from './firebase';
import { FIRESTORE_PATHS } from '@claude-reset/shared';

export type PushRegistrationResult =
  | { ok: true }
  | { ok: false; reason: 'permission-denied' | 'no-token' | 'error'; message: string };

/**
 * Registers this phone for push notifications:
 *   1. Registers the Firebase Messaging service worker at the root path
 *      (generated at build time — see scripts/generate-messaging-sw.mjs)
 *   2. Requests Notification permission (browser-native prompt)
 *   3. Gets an FCM token scoped to that service worker registration
 *   4. Writes it to Firestore under users/{uid}/pushSubscriptions/{token}
 *
 * Uses the raw token itself as the Firestore document ID (not an
 * auto-generated ID). This makes re-registration naturally idempotent —
 * opening this page again on the same phone just overwrites the same
 * document instead of accumulating duplicate tokens for the same device.
 * FCM tokens don't contain '/' or match Firestore's reserved __*__ pattern,
 * so they're safe to use directly as document IDs.
 */
export async function registerForPushNotifications(uid: string): Promise<PushRegistrationResult> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { ok: false, reason: 'permission-denied', message: 'Notification permission was not granted.' };
    }

    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    await navigator.serviceWorker.ready;

    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
    const token = await getToken(getMessagingInstance(), {
      vapidKey,
      serviceWorkerRegistration: registration,
    });

    if (!token) {
      return { ok: false, reason: 'no-token', message: 'Firebase did not return a push token.' };
    }

    const db = getFirestore(firebaseApp);
    const ref = doc(db, FIRESTORE_PATHS.pushSubscriptions(uid), token);

    await setDoc(ref, {
      fcmToken: token,
      createdAt: Date.now(),
      lastSeen: Date.now(),
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
