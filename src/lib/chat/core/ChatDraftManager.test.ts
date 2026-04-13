import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock esm-env so runed's PersistedState uses the window/localStorage
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

// Provide a proper Web Storage API (jsdom's localStorage lacks standard methods)
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

import { ChatDraftManager } from './ChatDraftManager.svelte';

describe('ChatDraftManager', () => {
	let manager: ChatDraftManager;

	beforeAll(() => {
		vi.stubGlobal('localStorage', localStorageMock);
	});

	afterAll(() => {
		vi.unstubAllGlobals();
	});

	beforeEach(() => {
		storage.clear();
		manager = new ChatDraftManager('test-drafts-' + Math.random());
	});

	it('stores and retrieves a draft', () => {
		manager.setDraft('thread-1', 'hello world');
		expect(manager.getDraft('thread-1')).toBe('hello world');
	});

	it('returns empty string for unknown thread', () => {
		expect(manager.getDraft('nonexistent')).toBe('');
	});

	it('returns empty string for null threadId', () => {
		expect(manager.getDraft(null)).toBe('');
	});

	it('removes key when setDraft is called with empty string', () => {
		manager.setDraft('thread-1', 'draft text');
		manager.setDraft('thread-1', '');
		expect(manager.getDraft('thread-1')).toBe('');
		expect('thread-1' in manager.drafts.current).toBe(false);
	});

	it('removes key when setDraft is called with whitespace-only string', () => {
		manager.setDraft('thread-1', 'draft text');
		manager.setDraft('thread-1', '   ');
		expect(manager.getDraft('thread-1')).toBe('');
		expect('thread-1' in manager.drafts.current).toBe(false);
	});

	it('clearDraft removes the key', () => {
		manager.setDraft('thread-1', 'draft text');
		manager.clearDraft('thread-1');
		expect(manager.getDraft('thread-1')).toBe('');
		expect('thread-1' in manager.drafts.current).toBe(false);
	});

	it('clearDraft is a no-op for null threadId', () => {
		manager.setDraft('thread-1', 'draft text');
		manager.clearDraft(null);
		expect(manager.getDraft('thread-1')).toBe('draft text');
	});

	it('setDraft is a no-op for null threadId', () => {
		manager.setDraft(null, 'should not store');
		expect(Object.keys(manager.drafts.current)).toHaveLength(0);
	});

	it('preserves other drafts when clearing one', () => {
		manager.setDraft('thread-1', 'draft 1');
		manager.setDraft('thread-2', 'draft 2');
		manager.clearDraft('thread-1');
		expect(manager.getDraft('thread-1')).toBe('');
		expect(manager.getDraft('thread-2')).toBe('draft 2');
	});
});
