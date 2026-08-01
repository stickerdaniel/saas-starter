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

	it('drops the transfer identity, which no longer names anything', () => {
		new ChatAttachmentStore(surface).write(new Map([['thread-1', [uploaded()]]]));

		const restored = new ChatAttachmentStore(surface).read().get('thread-1')?.[0];
		expect(restored && 'key' in restored ? restored.key : undefined).toBeUndefined();
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

		// A composer left open all day keeps saving. Were the stamp refreshed
		// here, the entry would outlive the file it points at.
		vi.setSystemTime(new Date('2026-08-01T19:00:00Z'));
		const midday = new ChatAttachmentStore(surface);
		midday.write(new Map([['thread-1', [uploaded()]]]));

		vi.setSystemTime(new Date('2026-08-01T21:00:00Z'));
		expect(new ChatAttachmentStore(surface).read().size).toBe(0);
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
