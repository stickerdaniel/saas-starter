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

import { ChatDraftManager } from './chat-draft-manager.svelte.ts';
import { DRAFT_STORAGE_PREFIX } from './chat-persisted-state.js';

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
		manager = new ChatDraftManager('test-' + Math.random());
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

	it('clears only the unchanged draft captured by a checkpoint', () => {
		manager.setDraft('thread-1', 'send this');
		const checkpoint = manager.captureCheckpoint('thread-1');
		manager.setDraft('thread-2', 'keep this');

		expect(manager.clearDraftIfUnchanged(checkpoint)).toBe(true);
		expect(manager.getDraft('thread-1')).toBe('');
		expect(manager.getDraft('thread-2')).toBe('keep this');
	});

	it.each(['a newer draft', 'send this'])(
		'preserves a later %s write after the checkpoint',
		(later) => {
			manager.setDraft('thread-1', 'send this');
			const checkpoint = manager.captureCheckpoint('thread-1');
			manager.setDraft('thread-1', later);

			expect(manager.clearDraftIfUnchanged(checkpoint)).toBe(false);
			expect(manager.getDraft('thread-1')).toBe(later);
		}
	);

	it('can clear the created thread for a null-origin conversation', () => {
		const checkpoint = manager.captureCheckpoint(null);

		expect(manager.clearDraftIfUnchanged(checkpoint, 'thread-created')).toBe(true);
		expect(manager.getDraft('thread-created')).toBe('');
	});

	it('two managers do not clear an equal-valued later write from another manager', () => {
		const surface = 'shared-' + Math.random();
		const managerA = new ChatDraftManager(surface);
		const managerB = new ChatDraftManager(surface);
		managerA.setDraft('same-thread', 'identical text');
		const checkpoint = managerA.captureCheckpoint('same-thread');
		managerB.setDraft('same-thread', 'identical text');

		expect(managerA.clearDraftIfUnchanged(checkpoint)).toBe(false);
		expect(managerB.getDraft('same-thread')).toBe('identical text');
	});
});

describe('ChatDraftManager with malformed storage', () => {
	const surface = 'malformed-test';
	const key = `${DRAFT_STORAGE_PREFIX}${surface}`;
	const secret = 'my unsent message';

	beforeAll(() => {
		vi.stubGlobal('localStorage', localStorageMock);
	});

	afterAll(() => {
		vi.unstubAllGlobals();
	});

	beforeEach(() => {
		storage.clear();
	});

	function logged(spy: ReturnType<typeof vi.spyOn>): string {
		return spy.mock.calls.flat().map(String).join(' ');
	}

	it.each([
		['invalid JSON', `{"thread-1": "${secret}`],
		['null', 'null']
	])('starts empty from %s without logging the stored text', (_, stored) => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		storage.set(key, stored);
		const manager = new ChatDraftManager(surface);
		expect(manager.getDraft('thread-1')).toBe('');
		expect(logged(errors)).not.toContain(secret);
		errors.mockRestore();
	});

	it('keeps string drafts of any length and drops other values', () => {
		const long = 'x'.repeat(10_000);
		storage.set(key, JSON.stringify({ a: 'ok', b: 5, c: long }));
		const manager = new ChatDraftManager(surface);
		expect(manager.getDraft('a')).toBe('ok');
		expect(manager.getDraft('b')).toBe('');
		expect(manager.getDraft('c')).toBe(long);
	});

	it('survives a malformed value written by another tab', () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		const manager = new ChatDraftManager(surface);
		manager.setDraft('thread-1', 'hello');
		const malformed = `{"x": "${secret}`;
		storage.set(key, malformed);
		window.dispatchEvent(new StorageEvent('storage', { key, newValue: malformed }));
		expect(manager.getDraft('thread-1')).toBe('');
		expect(logged(errors)).not.toContain(secret);
		errors.mockRestore();
	});
});
