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

import { clearPersistedChatState } from './chat-persisted-state.ts';

describe('clearPersistedChatState', () => {
	beforeAll(() => {
		vi.stubGlobal('localStorage', localStorageMock);
	});

	afterAll(() => {
		vi.unstubAllGlobals();
	});

	beforeEach(() => {
		storage.clear();
	});

	it('empties every draft and every stored attachment', () => {
		storage.set('drafts:ai-chat', '{"thread-1":"half a sentence"}');
		storage.set('drafts:support', '{}');
		storage.set('attachments:ai-chat', '{"thread-1":[{"name":"secret.pdf"}]}');
		storage.set('attachments:admin-support', '{}');

		clearPersistedChatState();

		expect([...storage.values()]).toEqual(['{}', '{}', '{}', '{}']);
	});

	it('leaves storage that belongs to someone else', () => {
		storage.set('drafts:ai-chat', '{"thread-1":"mine"}');
		storage.set('supportUserId', 'anon-42');
		storage.set('theme', 'dark');

		clearPersistedChatState();

		expect(storage.get('supportUserId')).toBe('anon-42');
		expect(storage.get('theme')).toBe('dark');
		expect(storage.get('drafts:ai-chat')).toBe('{}');
	});

	it('reaches every key, not just the ones it walks past first', () => {
		for (let i = 0; i < 6; i++) storage.set(`drafts:surface-${i}`, `{"t":"draft ${i}"}`);

		clearPersistedChatState();

		expect([...storage.values()]).toEqual(['{}', '{}', '{}', '{}', '{}', '{}']);
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
});
