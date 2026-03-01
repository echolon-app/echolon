/**
 * Per-tab storage for the Ace Editor search value in the center panel response section.
 * Keyed by request tab id so each tab remembers its own search independently.
 */
const store = new Map<string, string>();

export function getResponseBodySearch(tabId: string | null): string {
  if (!tabId) return '';
  return store.get(tabId) ?? '';
}

export function setResponseBodySearch(tabId: string | null, value: string): void {
  if (!tabId) return;
  if (value) {
    store.set(tabId, value);
  } else {
    store.delete(tabId);
  }
}
