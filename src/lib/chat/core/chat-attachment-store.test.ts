import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock esm-env so runed's PersistedState uses the window/localStorage
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

// Provide a proper Web Storage API (jsdom's localStorage lacks standard methods)
const storage = new Map<string, string>();
const writes = { count: 0 };
const localStorageMock: Storage = {
	getItem: (key: string) => storage.get(key) ?? null,
	setItem: (key: string, value: string) => {
		writes.count++;
		storage.set(key, value);
	},
	removeItem: (key: string) => storage.delete(key),
	clear: () => storage.clear(),
	get length() {
		return storage.size;
	},
	key: (index: number) => [...storage.keys()][index] ?? null
};

import type { Attachment } from './types.js';
import { ChatAttachmentStore } from './chat-attachment-store.svelte.ts';
import { clearPersistedChatState } from './chat-persisted-state.ts';

/** A file whose upload finished, which is the only kind that is stored. */
function uploaded(overrides: Partial<Extract<Attachment, { type: 'file' }>> = {}): Attachment {
	return {
		type: 'file',
		key: 'upload-1',
		name: 'report.pdf',
		size: 2048,
		mimeType: 'application/pdf',
		url: 'https://files.example/report.pdf',
		uploadState: { status: 'success', progress: 100, fileId: 'file-1' },
		...overrides
	};
}

/**
 * What actually landed in storage.
 *
 * The negative cases assert on this rather than on `read()`: an entry that is
 * written but malformed is refused on the way back out too, so reading alone
 * cannot tell "never stored" from "stored wrong".
 */
function written(): unknown {
	return JSON.parse(storage.get(`attachments:${surface}`) ?? '{}');
}

let surface: string;

describe('ChatAttachmentStore', () => {
	beforeAll(() => {
		vi.stubGlobal('localStorage', localStorageMock);
	});

	afterAll(() => {
		vi.unstubAllGlobals();
	});

	beforeEach(() => {
		storage.clear();
		writes.count = 0;
		surface = 'test-' + Math.random();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('offers an uploaded attachment back to a later store', () => {
		new ChatAttachmentStore(surface).write(new Map([['thread-1', [uploaded()]]]));

		const restored = new ChatAttachmentStore(surface).read().get('thread-1');
		expect(restored).toHaveLength(1);
		expect(restored?.[0]).toMatchObject({
			type: 'file',
			name: 'report.pdf',
			size: 2048,
			mimeType: 'application/pdf',
			url: 'https://files.example/report.pdf',
			uploadState: { status: 'success', progress: 100, fileId: 'file-1' }
		});
	});

	it('keeps the dimensions an image tile needs', () => {
		const image = uploaded({ mimeType: 'image/webp', width: 800, height: 600 });
		new ChatAttachmentStore(surface).write(new Map([['thread-1', [image]]]));

		expect(new ChatAttachmentStore(surface).read().get('thread-1')?.[0]).toMatchObject({
			width: 800,
			height: 600
		});
	});

	it('gives every restored attachment an identity of its own', () => {
		// Two pictures that were re-encoded to the same name and size, which the
		// composer would otherwise be unable to tell apart: it falls back to name
		// and size when an attachment carries no key, and two tiles under one key
		// take the list down.
		const twin = (transfer: string) =>
			uploaded({ key: transfer, url: `https://files.example/${transfer}` });
		new ChatAttachmentStore(surface).write(
			new Map([['thread-1', [twin('upload-a'), twin('upload-b')]]])
		);

		const restored = new ChatAttachmentStore(surface).read().get('thread-1') ?? [];
		const keys = restored.map((a) => ('key' in a ? a.key : undefined));
		expect(keys.filter(Boolean)).toHaveLength(2);
		expect(new Set(keys).size).toBe(2);
	});

	it('cannot be written back into by a store that outlived the sweep', () => {
		// A signed-out session leaves stores alive: the support widget outlives the
		// route it was signed out from, and other tabs outlive the document. Runed
		// answers a read from the value it started with once the key is gone, so
		// removing the key instead of emptying it would let one of them restore
		// the previous person's files for whoever signs in next.
		new ChatAttachmentStore(surface).write(new Map([['thread-1', [uploaded()]]]));
		// Started up while that was already there, and holds it from then on.
		const surviving = new ChatAttachmentStore(surface);

		clearPersistedChatState();
		surviving.write(new Map([['thread-2', [uploaded({ url: 'https://files.example/b' })]]]));

		expect(new ChatAttachmentStore(surface).read().has('thread-1')).toBe(false);
	});

	it('clears out a thread nobody came back to', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-01T08:00:00Z'));
		const store = new ChatAttachmentStore(surface);
		store.write(new Map([['abandoned', [uploaded()]]]));

		// Only ever filtering on the way out would leave this in storage for good:
		// nothing hands it back, and every later save carries it along.
		vi.setSystemTime(new Date('2026-08-02T08:00:00Z'));
		store.write(new Map([['current', [uploaded({ url: 'https://files.example/b' })]]]));

		expect(Object.keys(written() as object)).toEqual(['current']);
	});

	it('keeps an attachment its age when the composer is emptied and put back', () => {
		// A failed send clears the composer and restores the same attachments
		// (`ChatInput.handleSend`). The file on the server is no younger for it,
		// so a fresh stamp would keep offering one the vacuum has collected.
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-01T08:00:00Z'));
		const store = new ChatAttachmentStore(surface);
		store.write(new Map([['thread-1', [uploaded()]]]));

		vi.setSystemTime(new Date('2026-08-01T19:00:00Z'));
		store.write(new Map([['thread-1', []]]));
		store.write(new Map([['thread-1', [uploaded()]]]));

		vi.setSystemTime(new Date('2026-08-01T21:00:00Z'));
		expect(new ChatAttachmentStore(surface).read().size).toBe(0);
	});

	it('does not store an upload that is still running', () => {
		const inFlight = uploaded({
			uploadState: { status: 'uploading', progress: 40 },
			url: undefined
		});
		new ChatAttachmentStore(surface).write(new Map([['thread-1', [inFlight]]]));

		expect(written()).toEqual({});
	});

	it('does not store an upload that failed', () => {
		const failed = uploaded({ uploadState: { status: 'error', progress: 0, error: 'network' } });
		new ChatAttachmentStore(surface).write(new Map([['thread-1', [failed]]]));

		expect(written()).toEqual({});
	});

	it('does not store an attachment that belongs to a sent message', () => {
		const sent: Attachment = { type: 'image', url: 'https://files.example/sent.png' };
		new ChatAttachmentStore(surface).write(new Map([['thread-1', [sent]]]));

		expect(written()).toEqual({});
	});

	it('stops offering an attachment once the vacuum could have collected it', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-01T08:00:00Z'));
		new ChatAttachmentStore(surface).write(new Map([['thread-1', [uploaded()]]]));

		vi.setSystemTime(new Date('2026-08-01T19:00:00Z'));
		expect(new ChatAttachmentStore(surface).read().get('thread-1')).toHaveLength(1);

		vi.setSystemTime(new Date('2026-08-01T21:00:00Z'));
		expect(new ChatAttachmentStore(surface).read().size).toBe(0);
	});

	it('ages an attachment from its upload, not from the last save', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-01T08:00:00Z'));
		new ChatAttachmentStore(surface).write(new Map([['thread-1', [uploaded()]]]));

		// A page that takes this back and saves again, which every load does.
		// Were the stamp refreshed there, the entry would outlive the file it
		// points at, and each further load would renew it again.
		vi.setSystemTime(new Date('2026-08-01T19:00:00Z'));
		const midday = new ChatAttachmentStore(surface);
		const back = midday.read().get('thread-1') ?? [];
		midday.write(new Map([['thread-1', back]]));

		vi.setSystemTime(new Date('2026-08-01T21:00:00Z'));
		expect(new ChatAttachmentStore(surface).read().size).toBe(0);
	});

	it('gives the same file uploaded a second time an age of its own', () => {
		// Agent storage deduplicates by content, so picking the same bytes again
		// hands back the fileId the first upload got, with its clock started over.
		// Only the transfer tells the two apart.
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-01T08:00:00Z'));
		const store = new ChatAttachmentStore(surface);
		store.write(new Map([['thread-1', [uploaded()]]]));
		store.write(new Map([['thread-1', []]]));

		vi.setSystemTime(new Date('2026-08-01T19:00:00Z'));
		store.write(new Map([['thread-1', [uploaded({ key: 'upload-2' })]]]));

		vi.setSystemTime(new Date('2026-08-01T21:00:00Z'));
		expect(new ChatAttachmentStore(surface).read().get('thread-1')).toHaveLength(1);
	});

	it('forgets a thread whose composer was emptied', () => {
		const store = new ChatAttachmentStore(surface);
		store.write(new Map([['thread-1', [uploaded()]]]));
		store.write(new Map([['thread-1', []]]));

		expect(new ChatAttachmentStore(surface).read().size).toBe(0);
	});

	it('leaves threads it was not told about alone', () => {
		new ChatAttachmentStore(surface).write(new Map([['thread-1', [uploaded()]]]));
		// A second tab, which never saw thread-1, saving its own composer.
		new ChatAttachmentStore(surface).write(new Map([['thread-2', [uploaded()]]]));

		expect([...new ChatAttachmentStore(surface).read().keys()].sort()).toEqual([
			'thread-1',
			'thread-2'
		]);
	});

	it('does not rewrite storage when nothing changed', () => {
		const store = new ChatAttachmentStore(surface);
		store.write(new Map([['thread-1', [uploaded()]]]));
		const afterFirst = writes.count;

		// Stands in for the progress ticks of a second upload: they run through
		// the same save and change nothing that is stored.
		store.write(new Map([['thread-1', [uploaded()]]]));
		store.write(new Map([['thread-1', [uploaded()]]]));

		expect(writes.count).toBe(afterFirst);
	});

	it('starts empty when the stored value is not ours', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		storage.set(`attachments:${surface}`, '{"thread-1":[{"name":42}]}');

		expect(new ChatAttachmentStore(surface).read().size).toBe(0);
	});

	it('starts empty when the stored value is not even JSON', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		storage.set(`attachments:${surface}`, 'not json at all');

		expect(new ChatAttachmentStore(surface).read().size).toBe(0);
	});
});
