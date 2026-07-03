# Claude Reset Notifier — Setup Guide
### Windows (CMD) · Starting from scratch

---

## Overview

By the end of this guide you will have:
- The browser extension loaded and running in Brave
- A Firebase project connected (Auth + Firestore)
- The extension detecting your first Claude prompt and showing a live countdown
- Desktop notifications firing at the reset time

Phone notifications (Milestone 7) and the GitHub Actions dispatcher (Milestone 8) are separate steps, not covered here.

---

## Step 1 — Install Prerequisites

Open **Windows Terminal** (or CMD) and run each block in order.

### 1a. Node.js (LTS)

Download and run the installer from https://nodejs.org — choose the **LTS** version.

Verify:
```cmd
node --version
```
Expected: `v20.x.x` or higher.

### 1b. pnpm

```cmd
npm install -g pnpm@9
pnpm --version
```
Expected: `9.x.x`

### 1c. Git

Download from https://git-scm.com/download/win and run the installer (all defaults are fine).

```cmd
git --version
```

### 1d. Firebase CLI

```cmd
npm install -g firebase-tools
firebase --version
```

---

## Step 2 — Create Your Firebase Project

1. Go to https://console.firebase.google.com
2. Click **Add project** → name it `claude-reset-notifier` → disable Google Analytics (not needed) → **Create project**

### 2a. Enable Firestore

- Left sidebar → **Build → Firestore Database** → **Create database**
- Choose **Production mode** (the rules file in this repo locks it down properly)
- Pick any region close to you

### 2b. Enable Google Sign-In

- Left sidebar → **Build → Authentication** → **Get started**
- **Sign-in method** tab → **Google** → toggle **Enable** → enter your project's support email → **Save**

### 2c. Register a Web App

- Project Overview (home icon) → click **</>** (Web)
- App nickname: `extension` → **Register app**
- Copy the `firebaseConfig` object — you need these values in Step 4

### 2d. Get Your Web Client ID

- **Authentication** → **Sign-in method** → **Google** → expand the row
- Under **Web SDK configuration** → copy the **Web client ID**
- This is your `VITE_GOOGLE_CLIENT_ID`

---

## Step 3 — Clone and Set Up the Repo

```cmd
git clone https://github.com/YOUR_USERNAME/claude-reset-notifier.git
cd claude-reset-notifier
pnpm install
```

> If you haven't pushed to GitHub yet, just `cd` into the project folder you already have.

---

## Step 4 — Configure Environment Variables

### Extension

Copy the example file:
```cmd
copy apps\extension\.env.example apps\extension\.env.local
```

Open `apps\extension\.env.local` in any text editor and fill in the values from Step 2c and 2d:

```
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123:web:abc123
VITE_GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
```

### Companion PWA (values are the same — just copy them again)

```cmd
copy apps\companion-pwa\.env.example apps\companion-pwa\.env.local
```

Fill with the same Firebase values. Leave `VITE_FIREBASE_VAPID_KEY` empty for now (needed in Milestone 7).

---

## Step 5 — Build the Extension

```cmd
pnpm build:extension
```

Output goes to `apps\extension\dist\` — this folder is what you load into Brave.

---

## Step 6 — Load the Extension in Brave

1. Open Brave → address bar → type `brave://extensions` → Enter
2. Top-right: toggle **Developer mode** ON
3. Click **Load unpacked** → navigate to `apps\extension\dist` → **Select Folder**
4. The extension appears with a ⏱ icon in the toolbar

**Copy your Extension ID** — you'll need it in Step 7. It looks like: `abcdefghijklmnopabcdefghijklmnop`

---

## Step 7 — Register the OAuth Redirect URI

This is the chicken-and-egg step: you need the extension ID (from Step 6) to configure Google OAuth.

1. Go to https://console.cloud.google.com
2. Make sure your Firebase project is selected in the top dropdown
3. Left sidebar → **APIs & Services → Credentials**
4. Click the **OAuth 2.0 Client ID** that Firebase created (type: Web application)
5. Under **Authorized redirect URIs** → **Add URI**:
   ```
   https://YOUR_EXTENSION_ID.chromiumapp.org/
   ```
   Replace `YOUR_EXTENSION_ID` with the ID you copied in Step 6.
6. **Save**

> **Why this step exists:** `chrome.identity.launchWebAuthFlow` redirects the OAuth result back to `<extension-id>.chromiumapp.org`. Google must explicitly allow this URI, otherwise the sign-in will fail with a redirect_uri_mismatch error.

Now **rebuild** so Vite bakes in the updated config (the env vars don't change, but it's good practice):

```cmd
pnpm build:extension
```

Then go back to `brave://extensions` and click the **reload** button (↺) on the extension card.

---

## Step 8 — Deploy Firestore Rules

```cmd
cd firebase
firebase login
firebase use --add
```
When prompted, select your Firebase project and give it the alias `default`.

```cmd
firebase deploy --only firestore:rules
```

---

## Step 9 — Test End-to-End

1. Click the ⏱ extension icon in Brave → **Sign in with Google**
2. The Google account chooser popup appears — sign in
3. You should see **"No active session"** in the popup
4. Open https://claude.ai in a new tab
5. Send any message
6. Click the extension icon again — you should see:
   - **Session started** time
   - **Claude ready** time (5 hours from now)
   - A live countdown

**To test desktop notifications without waiting 5 hours:**

Open the extension service worker console:
- `brave://extensions` → find your extension → **Service Worker** link → **inspect**
- In the console, run:

```javascript
chrome.alarms.create('claude-reset-alarm', { when: Date.now() + 10000 });
```

This fires the alarm in 10 seconds and the desktop notification should appear.

---

## Milestone 3 Test Checklist

| Test | Expected result |
|---|---|
| Sign in with Google | Google popup appears, signs in successfully |
| Send first Claude prompt | Popup shows active session with countdown |
| Send more prompts in the same session | Countdown does NOT reset |
| Close and reopen popup | State persists correctly from storage |
| Service worker test alarm | Desktop notification appears with correct message |

---

## Troubleshooting

**Sign-in fails with `redirect_uri_mismatch`**
→ You skipped or mis-typed Step 7. Double-check the extension ID and the URI you added in Google Cloud Console.

**Sign-in fails with `Auth cancelled`**
→ Brave blocked the popup. Go to `brave://settings/content/popups` and allow `chrome-extension://` origins, or use Chrome to test.

**Extension popup shows blank / white screen**
→ Open the popup DevTools: right-click the extension icon → **Inspect popup** → check the Console tab for errors.

**"No active session" even after sending a prompt**
→ The DOM selector may not match Claude's current UI. Open Claude, send a message, right-click your message bubble → Inspect, find a unique attribute on the element, add it to `USER_MESSAGE_SELECTORS` in `apps/extension/src/content/detector.ts`, rebuild, and reload the extension.

**`pnpm install` fails on Windows with EPERM errors**
→ Run CMD as Administrator, or temporarily disable real-time protection in Windows Defender (it sometimes locks files during npm installs).

---

## File Reference

```
apps/extension/dist/      ← Load this folder as an unpacked extension in Brave
apps/extension/.env.local ← Your Firebase config (gitignored, never commit)
apps/extension/src/content/detector.ts  ← Update selectors here if Claude's UI changes
```

## What's Next

| Milestone | What it adds |
|---|---|
| M4 | Remote reset window config from Firestore |
| M5 | Firestore sync (session state written to cloud) |
| M6 | Phone push token registration (companion PWA) |
| M7 | Full companion PWA with FCM push |
| M8 | GitHub Actions dispatcher (phone notifications fire even when laptop is closed) |
