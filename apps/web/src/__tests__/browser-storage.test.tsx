import {
  BROWSER_STORAGE_KEYS,
  isStorageAvailable,
  isQuotaExceededError,
  safeGetItem,
  safeSetItem,
  safeRemoveItem,
  getStorageUsageSummary,
  clearGuestStorage,
} from '@/lib/browser-storage';
import { readGuestWorkspace, writeGuestWorkspace } from '@/lib/workspace-storage';

describe('browser-storage utility and retention behavior', () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.restoreAllMocks();
  });

  describe('isStorageAvailable', () => {
    it('returns true when localStorage is available and writable', () => {
      expect(isStorageAvailable('localStorage')).toBe(true);
    });

    it('returns false when localStorage.setItem throws (e.g. restricted or private browsing)', () => {
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Access denied');
      });
      expect(isStorageAvailable('localStorage')).toBe(false);
    });
  });

  describe('isQuotaExceededError', () => {
    it('identifies standard QuotaExceededError by name', () => {
      const err = new Error('The quota has been exceeded');
      err.name = 'QuotaExceededError';
      expect(isQuotaExceededError(err)).toBe(true);
    });

    it('identifies Firefox NS_ERROR_DOM_QUOTA_REACHED', () => {
      const err = { name: 'NS_ERROR_DOM_QUOTA_REACHED', code: 1014 };
      expect(isQuotaExceededError(err)).toBe(true);
    });

    it('identifies W3C DOMException code 22', () => {
      const err = { name: 'DOMException', code: 22 };
      expect(isQuotaExceededError(err)).toBe(true);
    });

    it('identifies errors with quota in the message', () => {
      const err = new Error('Persistent storage quota reached for origin');
      expect(isQuotaExceededError(err)).toBe(true);
    });

    it('returns false for unrelated errors', () => {
      expect(isQuotaExceededError(new Error('Network error'))).toBe(false);
      expect(isQuotaExceededError(null)).toBe(false);
      expect(isQuotaExceededError(undefined)).toBe(false);
      expect(isQuotaExceededError('quota string')).toBe(false);
    });
  });

  describe('safeGetItem and safeSetItem', () => {
    it('stores and retrieves complex JSON structures safely', () => {
      const payload = { id: 'ws-1', name: 'Test', operations: [{ type: 'payment', amount: '50' }] };
      const writeResult = safeSetItem('savitools:test', payload);

      expect(writeResult.success).toBe(true);
      expect(writeResult.quotaExceeded).toBe(false);

      const retrieved = safeGetItem('savitools:test', null);
      expect(retrieved).toEqual(payload);
    });

    it('returns fallback if key does not exist', () => {
      const result = safeGetItem('savitools:nonexistent', { defaultValue: true });
      expect(result).toEqual({ defaultValue: true });
    });

    it('handles corrupted JSON payloads without throwing and returns fallback', () => {
      window.localStorage.setItem('savitools:corrupted', '{invalid-json');
      const result = safeGetItem('savitools:corrupted', { fallback: true });
      expect(result).toEqual({ fallback: true });
    });

    it('catches QuotaExceededError and flags quotaExceeded: true', () => {
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        const err = new Error('Quota exceeded');
        err.name = 'QuotaExceededError';
        Object.assign(err, { code: 22 });
        throw err;
      });

      const writeResult = safeSetItem('savitools:huge-item', { large: 'data' });
      expect(writeResult.success).toBe(false);
      expect(writeResult.quotaExceeded).toBe(true);
    });

    it('catches generic storage access errors without throwing', () => {
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('SecurityError: storage blocked');
      });

      const writeResult = safeSetItem('savitools:blocked', { value: 123 });
      expect(writeResult.success).toBe(false);
      expect(writeResult.quotaExceeded).toBe(false);
    });
  });

  describe('safeRemoveItem', () => {
    it('removes the specified key from localStorage', () => {
      safeSetItem('savitools:remove-me', 'sample');
      expect(window.localStorage.getItem('savitools:remove-me')).not.toBeNull();

      safeRemoveItem('savitools:remove-me');
      expect(window.localStorage.getItem('savitools:remove-me')).toBeNull();
    });

    it('does not throw when removeItem fails', () => {
      jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('Removal blocked');
      });

      expect(() => safeRemoveItem('savitools:any')).not.toThrow();
    });
  });

  describe('getStorageUsageSummary', () => {
    it('estimates bytes and counts entries matching prefix', () => {
      safeSetItem('savitools:k1', 'val1');
      safeSetItem('savitools:k2', 'val2');
      window.localStorage.setItem('other:app:data', 'unrelated');

      const summary = getStorageUsageSummary();
      expect(summary.entryCount).toBe(2);
      expect(summary.keys).toContain('savitools:k1');
      expect(summary.keys).toContain('savitools:k2');
      expect(summary.keys).not.toContain('other:app:data');
      expect(summary.usedBytes).toBeGreaterThan(0);
    });
  });

  describe('clearGuestStorage and retention boundary', () => {
    it('clears guest workspaces while preserving preferences and theme', () => {
      safeSetItem('savitools:guest:composer', { draft: true });
      safeSetItem('savitools:guest:workspaces:composer', [{ id: '1', name: 'Draft' }]);
      safeSetItem('savitools:guest:workspace:composer:1', { ops: [] });
      safeSetItem(BROWSER_STORAGE_KEYS.CONTRACTS_HISTORY, [{ id: 'C1' }]);
      safeSetItem(BROWSER_STORAGE_KEYS.FEDERATION_COUNTERPARTIES, [{ input: 'user*domain' }]);

      // Persistent preferences that must be kept
      safeSetItem(BROWSER_STORAGE_KEYS.USER_PREFERENCES, { keyboardShortcutsEnabled: true });
      safeSetItem(BROWSER_STORAGE_KEYS.THEME, 'dark');

      clearGuestStorage();

      // Guest data is evicted
      expect(safeGetItem('savitools:guest:composer', null)).toBeNull();
      expect(safeGetItem('savitools:guest:workspaces:composer', null)).toBeNull();
      expect(safeGetItem('savitools:guest:workspace:composer:1', null)).toBeNull();
      expect(safeGetItem(BROWSER_STORAGE_KEYS.CONTRACTS_HISTORY, null)).toBeNull();
      expect(safeGetItem(BROWSER_STORAGE_KEYS.FEDERATION_COUNTERPARTIES, null)).toBeNull();

      // Preferences and theme remain intact
      expect(safeGetItem(BROWSER_STORAGE_KEYS.USER_PREFERENCES, null)).toEqual({
        keyboardShortcutsEnabled: true,
      });
      expect(safeGetItem(BROWSER_STORAGE_KEYS.THEME, null)).toBe('dark');
    });
  });

  describe('workspace-storage integration', () => {
    it('writes and reads guest workspace with safe storage', () => {
      const state = { composerState: { sourceAccount: 'G123' }, operations: [] };
      const success = writeGuestWorkspace('composer', state);
      expect(success).toBe(true);

      const loaded = readGuestWorkspace('composer', null);
      expect(loaded).toEqual(state);
    });
  });
});
