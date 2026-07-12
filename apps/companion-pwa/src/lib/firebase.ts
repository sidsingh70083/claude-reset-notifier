import { initializeApp, getApps, getApp } from 'firebase/app';
import { getMessaging, type Messaging } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseApp =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

let _messaging: Messaging | null = null;

/**
 * Lazily initialized — getMessaging() throws in browsers without push
 * support (or with notifications blocked at the OS level), so this is only
 * called from the "Enable Notifications" button handler, not at module load.
 */
export function getMessagingInstance(): Messaging {
  if (!_messaging) {
    _messaging = getMessaging(firebaseApp);
  }
  return _messaging;
}
