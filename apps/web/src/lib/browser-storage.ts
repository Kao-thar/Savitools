/**
 * Browser storage utility module for SaviTools.
 * Provides safe access, quota detection, error resilience, and retention tracking
 * for localStorage and sessionStorage across diverse browser environments.
 */

export const BROWSER_STORAGE_KEYS = {
  GUEST_WORKSPACE_PREFIX: 'savitools:guest:',
  GUEST_WORKSPACE_LIST_PREFIX: 'savitools:guest:workspaces:',
  GUEST_WORKSPACE_DATA_PREFIX: 'savitools:guest:workspace:',
  RECENT_ITEMS: 'savitools_recent_items',
  USER_PREFERENCES: 'savitools_user_preferences',
  PROFILES: 'savitools:profiles',
  ACTIVE_PROFILE_ID: 'savitools:active-profile-id',
  THEME: 'savitools:theme',
  ONBOARDING: 'savitools:onboarding',
  ONBOARDING_DISMISSED: 'savitools:onboarding:dismissed',
  CONTRACTS_HISTORY: 'savitools:contracts:history',
  FEDERATION_COUNTERPARTIES: 'savitools:federation:counterparties',
  LEGACY_COMPOSER_WORKSPACES: 'composer-workspaces',
} as const;

export type StorageKey = (typeof BROWSER_STORAGE_KEYS)[keyof typeof BROWSER_STORAGE_KEYS] | string;

export interface StorageWriteResult {
  success: boolean;
  quotaExceeded: boolean;
  error?: unknown;
}

export interface StorageUsageSummary {
  usedBytes: number;
  entryCount: number;
  keys: string[];
}

/**
 * Checks whether the specified storage mechanism (default: localStorage) is available and writable.
 * Accurately detects private browsing blocks and disabled cookies without throwing.
 */
export function isStorageAvailable(
  type: 'localStorage' | 'sessionStorage' = 'localStorage',
): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const storage = window[type];
    if (!storage) return false;
    const testKey = '__savitools_storage_test__';
    storage.setItem(testKey, '1');
    storage.removeItem(testKey);
    return true;
  } catch (err) {
    // Storage blocked or restricted
    return false;
  }
}

/**
 * Determines whether a caught exception represents a browser quota exceeded error.
 * Supports Chrome/Edge (QuotaExceededError, code 22), Firefox (NS_ERROR_DOM_QUOTA_REACHED, code 1014),
 * Safari private mode, and older IE/Edge error numbers.
 */
export function isQuotaExceededError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const err = error as { name?: string; code?: number; number?: number; message?: string };

  return Boolean(
    err.name === 'QuotaExceededError' ||
    err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    err.code === 22 ||
    err.code === 1014 ||
    err.number === -2147024882 ||
    (typeof err.message === 'string' && /quota/i.test(err.message)),
  );
}

/**
 * Safely reads and JSON-parses a value from localStorage.
 * Returns the fallback if window is undefined, storage is blocked, key is missing, or payload is corrupted.
 */
export function safeGetItem<T>(key: StorageKey, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null || raw === undefined) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch (err) {
    // Storage blocked or restricted
    return fallback;
  }
}

/**
 * Safely serializes and writes a value to localStorage.
 * Catches QuotaExceededError and SecurityError, returning an informative result object
 * instead of throwing uncaught exceptions into the UI thread.
 */
export function safeSetItem<T>(key: StorageKey, value: T): StorageWriteResult {
  if (typeof window === 'undefined') {
    return { success: false, quotaExceeded: false };
  }

  try {
    const serialized = JSON.stringify(value);
    window.localStorage.setItem(key, serialized);
    return { success: true, quotaExceeded: false };
  } catch (error) {
    const quota = isQuotaExceededError(error);
    return {
      success: false,
      quotaExceeded: quota,
      error,
    };
  }
}

/**
 * Safely removes a key from localStorage.
 */
export function safeRemoveItem(key: StorageKey): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(key);
  } catch (err) {
    // Storage blocked or restricted
    // Ignore removal errors (e.g. security restrictions)
  }
}

/**
 * Estimates storage usage by SaviTools keys in localStorage.
 * Returns approximate byte count (UTF-16 characters * 2 bytes) and matching keys.
 */
export function getStorageUsageSummary(prefix = 'savitools'): StorageUsageSummary {
  if (typeof window === 'undefined') {
    return { usedBytes: 0, entryCount: 0, keys: [] };
  }

  try {
    let totalChars = 0;
    const matchingKeys: string[] = [];

    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && (key.startsWith(prefix) || key.startsWith('composer-workspaces'))) {
        matchingKeys.push(key);
        const val = window.localStorage.getItem(key) ?? '';
        totalChars += key.length + val.length;
      }
    }

    return {
      usedBytes: totalChars * 2, // Approximate UTF-16 byte representation
      entryCount: matchingKeys.length,
      keys: matchingKeys,
    };
  } catch (err) {
    // Storage blocked or restricted
    return { usedBytes: 0, entryCount: 0, keys: [] };
  }
}

/**
 * Clears all guest workspaces and ephemeral tool states while preserving user preferences and theme.
 */
export function clearGuestStorage(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (
        key &&
        (key.startsWith(BROWSER_STORAGE_KEYS.GUEST_WORKSPACE_PREFIX) ||
          key.startsWith(BROWSER_STORAGE_KEYS.GUEST_WORKSPACE_LIST_PREFIX) ||
          key.startsWith(BROWSER_STORAGE_KEYS.GUEST_WORKSPACE_DATA_PREFIX) ||
          key === BROWSER_STORAGE_KEYS.CONTRACTS_HISTORY ||
          key === BROWSER_STORAGE_KEYS.FEDERATION_COUNTERPARTIES ||
          key === BROWSER_STORAGE_KEYS.LEGACY_COMPOSER_WORKSPACES)
      ) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      window.localStorage.removeItem(key);
    }
  } catch (err) {
    // Storage blocked or restricted
    // Ignore clear errors
  }
}
