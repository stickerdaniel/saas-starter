import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();
const localStorageMock: Storage = {
	getItem: (key: string) => storage.get(key) ?? null,
	setItem: (key: string, value: string) => storage.set(key, value),
	removeItem: (key: string) => storage.delete(key),
	clear: () => storage.clear(),
	get length() {
		return storage.size;
	},
	key: (index: number) => [...storage.keys()][index] ?? null
};

import {
	clearPersistedChatState,
	getChatSessionEpoch,
	reconcilePersistedChatAttachments,
	registerPersistedChatHolder
} from './chat-persisted-state.ts';

/** What the composers are keeping, without the signal that sits beside them. */
function composerValues(): string[] {
	return [...storage.entries()]
		.filter(([key]) => key.startsWith('drafts:') || key.startsWith('attachments:'))
		.map(([, value]) => value);
}

describe('clearPersistedChatState', () => {
	beforeAll(() => {
		vi.stubGlobal('localStorage', localStorageMock);
	});

	afterAll(() => {
		vi.unstubAllGlobals();
	});

	beforeEach(() => {
		vi.restoreAllMocks();
		storage.clear();
	});

	it('empties every draft and every stored attachment', () => {
		storage.set('drafts:ai-chat', '{"thread-1":"half a sentence"}');
		storage.set('drafts:support', '{}');
		storage.set('attachments:ai-chat', '{"thread-1":[{"name":"secret.pdf"}]}');
		storage.set('attachments:admin-support', '{}');

		clearPersistedChatState();

		expect(composerValues()).toEqual(['{}', '{}', '{}', '{}']);
	});

	it('leaves storage that belongs to someone else', () => {
		storage.set('drafts:ai-chat', '{"thread-1":"mine"}');
		storage.set('supportUserId', 'anon-42');
		storage.set('theme', 'dark');

		clearPersistedChatState();

		// The other tabs, which this page cannot reach directly, are told too.
		expect(storage.get('chat:session-ended')).toBeTruthy();
		expect(storage.get('supportUserId')).toBe('anon-42');
		expect(storage.get('theme')).toBe('dark');
		expect(storage.get('drafts:ai-chat')).toBe('{}');
	});

	it('reaches every key, not just the ones it walks past first', () => {
		for (let i = 0; i < 6; i++) storage.set(`drafts:surface-${i}`, `{"t":"draft ${i}"}`);

		clearPersistedChatState();

		expect(composerValues()).toEqual(['{}', '{}', '{}', '{}', '{}', '{}']);
	});

	it('does not throw when storage is unavailable', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const denied: Storage = {
			...localStorageMock,
			get length(): number {
				throw new DOMException('SecurityError');
			}
		};
		vi.stubGlobal('localStorage', denied);

		expect(() => clearPersistedChatState()).not.toThrow();

		vi.stubGlobal('localStorage', localStorageMock);
	});

	it('logs only a safe marker when a holder fails during cleanup', () => {
		const diagnostic = new Error('draft contained private customer content');
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const unregister = registerPersistedChatHolder({
			forgetPersistedState: () => {
				throw diagnostic;
			}
		});

		expect(() => clearPersistedChatState()).not.toThrow();

		expect(error).toHaveBeenCalledExactlyOnceWith('[ChatPersistence.forgetHolder] Failed');
		expect(error.mock.calls.flat()).not.toContain(diagnostic);
		expect(error.mock.calls.flat().join(' ')).not.toContain(diagnostic.message);
		unregister();
	});

	it('logs only a safe marker when attachment reconciliation fails', () => {
		const diagnostic = new Error('attachment URL contained a signed user token');
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const unregister = registerPersistedChatHolder({
			forgetPersistedState: () => {},
			reconcilePersistedAttachments: () => {
				throw diagnostic;
			}
		});

		expect(() => reconcilePersistedChatAttachments('support', 'thread-1', [])).not.toThrow();

		expect(error).toHaveBeenCalledExactlyOnceWith('[ChatPersistence.reconcileAttachments] Failed');
		expect(error.mock.calls.flat()).not.toContain(diagnostic);
		expect(error.mock.calls.flat().join(' ')).not.toContain(diagnostic.message);
		unregister();
	});

	it('logs only a safe marker when storage cleanup fails', () => {
		const diagnostic = new Error('storage backend exposed private draft data');
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const denied: Storage = {
			...localStorageMock,
			setItem: () => {
				throw diagnostic;
			}
		};
		vi.stubGlobal('localStorage', denied);

		expect(() => clearPersistedChatState()).not.toThrow();

		expect(error).toHaveBeenCalledExactlyOnceWith('[ChatPersistence.clearStorage] Failed');
		expect(error.mock.calls.flat()).not.toContain(diagnostic);
		expect(error.mock.calls.flat().join(' ')).not.toContain(diagnostic.message);
		vi.stubGlobal('localStorage', localStorageMock);
	});

	it('advances the epoch before holders and before failing storage cleanup', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const before = getChatSessionEpoch();
		const holderEpochs: number[] = [];
		const unregister = registerPersistedChatHolder({
			forgetPersistedState: () => holderEpochs.push(getChatSessionEpoch())
		});
		const denied: Storage = {
			...localStorageMock,
			setItem: () => {
				throw new DOMException('QuotaExceededError');
			}
		};
		vi.stubGlobal('localStorage', denied);

		clearPersistedChatState();

		expect(getChatSessionEpoch()).toBe(before + 1);
		expect(holderEpochs).toEqual([before + 1]);
		unregister();
		vi.stubGlobal('localStorage', localStorageMock);
	});

	it('advances the epoch before forgetting state from another document', () => {
		const before = getChatSessionEpoch();
		const holderEpochs: number[] = [];
		const unregister = registerPersistedChatHolder({
			forgetPersistedState: () => holderEpochs.push(getChatSessionEpoch())
		});

		window.dispatchEvent(
			new StorageEvent('storage', { key: 'chat:session-ended', newValue: 'new-session' })
		);

		expect(getChatSessionEpoch()).toBe(before + 1);
		expect(holderEpochs).toEqual([before + 1]);
		unregister();
	});
});
