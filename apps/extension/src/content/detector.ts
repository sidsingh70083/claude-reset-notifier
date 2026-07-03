/**
 * Content script injected on https://claude.ai/*
 *
 * Detects the first user message sent in a new session and notifies the
 * background service worker. Uses a MutationObserver (primary signal) that
 * watches for new user-message elements appearing in the DOM.
 *
 * ─── MAINTENANCE NOTE ────────────────────────────────────────────────────────
 * Claude's UI can change without notice. If detection stops working:
 *   1. Open claude.ai and send a message.
 *   2. Right-click your message bubble → Inspect.
 *   3. Find a unique attribute on the element (data-*, role, class).
 *   4. Add it to USER_MESSAGE_SELECTORS below and rebuild.
 *
 * The network signal (chrome.webRequest in background/index.ts) acts as a
 * fallback if the DOM selectors all break simultaneously.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { SESSION_START_DEBOUNCE_MS } from '@claude-reset/shared';

/**
 * Selectors tried in order. The first one that matches a newly-added DOM node
 * is used to confirm a user message has appeared. Add more specific selectors
 * at the top; broad fallbacks at the bottom.
 */
const USER_MESSAGE_SELECTORS: string[] = [
  // Attribute-based (most stable — less likely to change than class names)
  '[data-is-human-turn="true"]',
  '[data-message-author-role="user"]',
  '[data-testid="human-turn"]',

  // Class-based (update these if Claude redesigns)
  '.font-user-message',
  '[class*="human-turn"]',
  '[class*="user-message"]',
  '[class*="HumanTurn"]',
];

let lastDetectedAt = 0;

function isUserMessageNode(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  return USER_MESSAGE_SELECTORS.some((selector) => {
    try {
      // Check the node itself AND its subtree (message wrapper vs inner element)
      return node.matches(selector) || node.querySelector(selector) !== null;
    } catch {
      return false; // invalid selector — skip silently
    }
  });
}

function onPromptDetected(source: 'dom'): void {
  const now = Date.now();

  // Debounce: DOM signal can fire multiple times for a single message
  // (e.g., element added, then child elements appended separately)
  if (now - lastDetectedAt < SESSION_START_DEBOUNCE_MS) return;
  lastDetectedAt = now;

  chrome.runtime
    .sendMessage({ type: 'SESSION_PROMPT_DETECTED', timestamp: now, source })
    .catch(() => {
      /**
       * This catch is expected and harmless. The background service worker
       * may be asleep when the content script sends this message. The network
       * signal (webRequest listener) in the background SW will independently
       * detect the same prompt and start the session without needing this
       * message to arrive.
       */
    });
}

// ── MutationObserver ─────────────────────────────────────────────────────────

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (isUserMessageNode(node)) {
        onPromptDetected('dom');
        return; // one detection per batch of mutations is enough
      }
    }
  }
});

function startObserving(): void {
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// claude.ai is a SPA — the body is almost certainly ready by document_idle,
// but guard anyway for safety
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startObserving);
} else {
  startObserving();
}
