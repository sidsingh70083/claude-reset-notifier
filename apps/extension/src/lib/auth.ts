import { getAuth, GoogleAuthProvider, signInWithCredential, signOut } from 'firebase/auth';
import { firebaseApp } from './firebase';
import { setStoredUser, clearAllStorage } from './storage';
import type { StoredUser } from '@claude-reset/shared';

const auth = getAuth(firebaseApp);

/**
 * Sign in with Google using chrome.identity.launchWebAuthFlow.
 *
 * Why launchWebAuthFlow instead of getAuthToken?
 *   getAuthToken relies on the user being signed into the browser with their
 *   Google account (works in Chrome, unreliable in Brave). launchWebAuthFlow
 *   shows a standard Google OAuth popup that works in any Chromium browser.
 *
 * Setup requirement:
 *   After loading the extension, go to chrome://extensions, copy the extension ID,
 *   then add https://<EXTENSION_ID>.chromiumapp.org/ as an Authorized redirect URI
 *   in your Google Cloud Console OAuth 2.0 Web Client. See SETUP-GUIDE.md Step 4.
 */
export async function signInWithGoogle(): Promise<StoredUser> {
  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  if (!clientId) {
    throw new Error('VITE_GOOGLE_CLIENT_ID is not set. Check your .env.local file.');
  }

  // Random nonce — prevents replay attacks and is required when requesting id_token
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const authUrl = new URL('https://accounts.google.com/o/oauth2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'token id_token');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('nonce', nonce);
  // Prompt ensures the user sees the account chooser even if already authed
  authUrl.searchParams.set('prompt', 'select_account');

  const responseUrl = await new Promise<string>((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl.toString(), interactive: true },
      (url) => {
        if (chrome.runtime.lastError || !url) {
          reject(new Error(chrome.runtime.lastError?.message ?? 'Auth was cancelled'));
          return;
        }
        resolve(url);
      },
    );
  });

  // Tokens are returned in the URL fragment (implicit flow)
  const fragment = new URLSearchParams(new URL(responseUrl).hash.slice(1));
  const idToken = fragment.get('id_token');
  const accessToken = fragment.get('access_token');

  if (!idToken || !accessToken) {
    throw new Error('Missing tokens in OAuth response. Check your redirect URI configuration.');
  }

  const credential = GoogleAuthProvider.credential(idToken, accessToken);
  const { user } = await signInWithCredential(auth, credential);

  const storedUser: StoredUser = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
  };

  await setStoredUser(storedUser);
  return storedUser;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
  // Tell the background SW to clear its alarm
  chrome.runtime.sendMessage({ type: 'SIGN_OUT' }).catch(() => {
    // Background SW might be asleep; alarm will be cleared on next wake
  });
  await clearAllStorage();
}
