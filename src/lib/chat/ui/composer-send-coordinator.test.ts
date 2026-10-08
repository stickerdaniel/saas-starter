/**
 * Send settlement through the real composer.
 *
 * Every composer here is a real ChatInput over a real ChatUIContext. A remount
 * disposes the context and builds a new one on the same settlement owner, the
 * way a keyed surface does, and reads the draft the way surfaces do on mount.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { ConvexClient } from 'convex/browser';
import { getFunctionName } from 'convex/server';
import { api } from '#lib/convex/_generated/api.js';
import { ChatCore } from '../core/chat-core.svelte.ts';
import { ChatDraftManager } from '../core/chat-draft-manager.svelte.ts';
import { ChatAttachmentStore } from '../core/chat-attachment-store.svelte.ts';
import { clearPersistedChatState } from '../core/chat-persisted-state.ts';
import { DEFAULT_ATTACHMENT_PROFILE, MAX_MESSAGE_LENGTH, type Attachment } from '../core/types.js';
import type { UploadProfile } from '../../uploads/profiles.js';
import { ChatUIContext, type UploadConfig } from './chat-context.svelte.ts';
import {
	ComposerSendCoordinator,
	acquireComposerSendCoordinator,
	type ComposerSendLease
} from './composer-send-coordinator.ts';
import ChatTestProvider from './test-fixtures/ChatTestProvider.svelte';
import ChatInputHarness from './test-fixtures/ChatInputHarness.svelte';
import en from '../../../i18n/en.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('#lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));
vi.mock('./ChatAttachments.svelte', () => ({ default: () => {} }));

type Send = PromiseWithResolvers<void> & { prompt: string };

let client: ConvexClient;
const open: Array<{ component: ReturnType<typeof mount>; context: ChatUIContext }> = [];

function file(key: string): Extract<Attachment, { type: 'file' }> {
	return {
		type: 'file',
		key,
		name: `${key}.txt`,
		size: key.length,
		mimeType: 'text/plain',
		url: `https://chat.test/${key}.txt`,
		uploadState: { status: 'success', progress: 100, fileId: `file-${key}` }
	};
}

const keys = (attachments: Attachment[]) =>
	attachments.map((attachment) => ('key' in attachment ? attachment.key : undefined));

/** Let rejected and resolved sends reach the composer and the DOM. */
async function settleWork(): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	await tick();
}

/**
 * One chat surface: a settlement owner shared by every composer it mounts.
 *
 * `persistent` surfaces have a draft store and upload directly to storage with an
 * attachment store. The other kind uses its own transport with `release` and
 * keeps nothing.
 */
function chatSurface({
	persistent = true,
	profile,
	name = `settlement-${crypto.randomUUID()}`,
	owner: givenOwner
}: {
	persistent?: boolean;
	profile?: UploadProfile;
	name?: string;
	owner?: (drafts: ChatDraftManager | undefined) => ComposerSendCoordinator;
} = {}) {
	const drafts = persistent ? new ChatDraftManager(name) : undefined;
	const store = persistent ? new ChatAttachmentStore(name) : undefined;
	const release = vi.fn();
	const uploadConfig: UploadConfig = persistent
		? {
				generateUploadUrl: api.aiChat.files.generateUploadUrl,
				saveUploadedFile: api.aiChat.files.saveUploadedFile,
				attachmentStore: store,
				profile
			}
		: { upload: vi.fn(), release, profile };
	const owner = givenOwner?.(drafts) ?? new ComposerSendCoordinator({ drafts });
	const sends: Send[] = [];
	const restorations: string[] = [];
	const onSend = vi.fn((prompt: string): Promise<void> => {
		const send = Object.assign(Promise.withResolvers<void>(), { prompt });
		sends.push(send);
		return send.promise;
	});

	async function openComposer(threadId: string | null, core = new ChatCore({ threadId })) {
		const context = new ChatUIContext(core, client, uploadConfig, 'right', null, {
			bindThreadOrigin: (binder) => core.setThreadOriginBinder(binder),
			projectInput: (projection) => {
				if (projection.reason === 'send-restore') restorations.push(projection.value);
			},
			sendOwner: owner
		});
		context.setDisplayMessages([]);
		context.loadDraft(threadId);
		const target = document.body.appendChild(document.createElement('div'));
		const contentProps = { context, onSend };
		const component = mount(ChatTestProvider<typeof contentProps>, {
			target,
			props: { client, content: ChatInputHarness, contentProps }
		});
		const entry = { component, context };
		open.push(entry);
		await tick();
		const textarea = () => target.querySelector('textarea')!;
		const button = () =>
			target.querySelector<HTMLButtonElement>(`button[aria-label="${en.chat.aria.send}"]`)!;
		return {
			context,
			core,
			text: () => textarea().value,
			attachments: () => keys(context.attachments),
			notice: () => target.querySelector('[data-testid="chat-input-limit-notice"]'),
			button,
			async type(value: string) {
				textarea().value = value;
				textarea().dispatchEvent(new Event('input', { bubbles: true }));
				await tick();
			},
			async send(value: string, ...attached: string[]) {
				await this.type(value);
				context.addAttachments(attached.map(file));
				await tick();
				button().click();
				await tick();
			},
			async enter() {
				textarea().dispatchEvent(
					new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
				);
				await tick();
			},
			async close() {
				await unmount(component);
				context.dispose();
				target.remove();
				open.splice(open.indexOf(entry), 1);
			}
		};
	}

	return { owner, drafts, store, release, sends, restorations, onSend, open: openComposer };
}

/** A surface whose owner comes from the session's registry, the way a page gets it. */
function leasedSurface(name: string, options: { persistent?: boolean } = {}) {
	let lease!: ComposerSendLease;
	const chat = chatSurface({
		...options,
		name,
		owner: (drafts) => {
			lease = acquireComposerSendCoordinator(name, () => new ComposerSendCoordinator({ drafts }));
			return lease.owner;
		}
	});
	return { chat, lease };
}

/** What the transport hands back for `file(key)`. */
const fileA = { fileId: 'file-a', url: 'https://chat.test/a.txt' };
const fileB = { fileId: 'file-b', url: 'https://chat.test/b.txt' };

beforeEach(() => {
	localStorage.clear();
	client = new ConvexClient('https://settlement-test.convex.cloud', { disabled: true });
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
	for (const { component, context } of open.splice(0)) {
		await unmount(component);
		context.dispose();
	}
	// A surface owner left with an open send would otherwise reach the next test.
	clearPersistedChatState();
	document.body.replaceChildren();
	await client.close();
	localStorage.clear();
	vi.restoreAllMocks();
});

describe('overlapping refusals', () => {
	it('restores nothing while the earlier send is open, then both in send order', async () => {
		const chat = chatSurface();
		const composer = await chat.open('thread-a');
		await composer.send('first', 'a');
		await composer.send('second', 'b');

		chat.sends[1]!.reject(new Error('refused'));
		await settleWork();
		expect(composer.text()).toBe('');
		expect(composer.attachments()).toEqual([]);

		chat.sends[0]!.reject(new Error('refused'));
		await settleWork();
		expect(composer.text()).toBe('first\n\nsecond');
		expect(composer.attachments()).toEqual(['a', 'b']);
		expect(chat.restorations).toEqual(['first\n\nsecond']);
	});

	it('holds an earlier refusal until the later send settles, ahead of newer typing', async () => {
		const chat = chatSurface();
		const composer = await chat.open('thread-a');
		await composer.send('A', 'a');
		await composer.send('B', 'b');
		await composer.type('newer');

		chat.sends[0]!.reject(new Error('refused'));
		await settleWork();
		expect(composer.text()).toBe('newer');
		expect(composer.attachments()).toEqual([]);
		expect(chat.restorations).toEqual([]);

		chat.sends[1]!.reject(new Error('refused'));
		await settleWork();
		expect(composer.text()).toBe('A\n\nB\n\nnewer');
		expect(composer.attachments()).toEqual(['a', 'b']);
		expect(chat.restorations).toEqual(['A\n\nB\n\nnewer']);
	});

	it('restores the whole group into a composer remounted between the refusals', async () => {
		const chat = chatSurface();
		const first = await chat.open('thread-a');
		await first.send('A', 'a');
		await first.send('B', 'b');
		chat.sends[0]!.reject(new Error('refused'));
		await settleWork();
		await first.close();

		const remounted = await chat.open('thread-a');
		await remounted.type('newer');
		chat.sends[1]!.reject(new Error('refused'));
		await settleWork();

		expect(remounted.text()).toBe('A\n\nB\n\nnewer');
		expect(remounted.attachments()).toEqual(['a', 'b']);
		expect(chat.restorations).toEqual(['A\n\nB\n\nnewer']);
		expect(first.context.inputValue).toBe('');
	});

	it.each([
		{ refused: 'A', order: ['A', 'B'] },
		{ refused: 'A', order: ['B', 'A'] },
		{ refused: 'B', order: ['A', 'B'] },
		{ refused: 'B', order: ['B', 'A'] }
	])('restores only refused $refused when settled in order $order', async ({ refused, order }) => {
		const chat = chatSurface();
		const composer = await chat.open('thread-a');
		await composer.send('A', 'a');
		await composer.send('B', 'b');

		for (const name of order) {
			const send = chat.sends[name === 'A' ? 0 : 1]!;
			if (name === refused) send.reject(new Error('refused'));
			else send.resolve();
			await settleWork();
		}

		expect(composer.text()).toBe(refused);
		expect(composer.attachments()).toEqual([refused.toLowerCase()]);
		expect(chat.restorations).toEqual([refused]);
	});

	it('counts only the first outcome of a send', async () => {
		const chat = chatSurface();
		const composer = await chat.open('thread-a');
		await composer.type('once');
		const snapshot = composer.context.captureSendSnapshot();
		composer.context.clearInputForSend(snapshot);
		const settle = composer.context.beginSend(snapshot);

		settle('refused');
		settle('refused');
		settle('accepted');
		await tick();

		expect(composer.text()).toBe('once');
		expect(chat.restorations).toEqual(['once']);
		expect(chat.drafts!.getDraft('thread-a')).toBe('once');
	});
});

describe('restored text', () => {
	it('puts refused text ahead of what was typed since', async () => {
		const chat = chatSurface();
		const composer = await chat.open('thread-a');
		await composer.send('failed');
		await composer.type('newer');

		chat.sends[0]!.reject(new Error('refused'));
		await settleWork();

		expect(composer.text()).toBe('failed\n\nnewer');
		expect(chat.drafts!.getDraft('thread-a')).toBe('failed\n\nnewer');
	});

	it('keeps an identical prompt typed again after the send', async () => {
		const chat = chatSurface();
		const composer = await chat.open('thread-a');
		await composer.send('same');
		await composer.type('same');

		chat.sends[0]!.reject(new Error('refused'));
		await settleWork();

		expect(composer.text()).toBe('same\n\nsame');
	});

	it('keeps two identical prompts that were both sent and refused', async () => {
		const chat = chatSurface();
		const composer = await chat.open('thread-a');
		await composer.send('same');
		await composer.send('same');

		chat.sends[0]!.reject(new Error('refused'));
		chat.sends[1]!.reject(new Error('refused'));
		await settleWork();

		expect(chat.onSend).toHaveBeenCalledTimes(2);
		expect(composer.text()).toBe('same\n\nsame');
	});
});

describe('composers that come and go', () => {
	it('restores into a remounted origin before the refusal and leaves the other thread alone', async () => {
		const chat = chatSurface();
		const a = await chat.open('thread-a');
		await a.send('from A', 'a');
		await a.close();
		const b = await chat.open('thread-b');
		await b.type('typed in B');
		b.context.addAttachments([file('b')]);
		await b.close();

		const remountedA = await chat.open('thread-a');
		await remountedA.type('newer A');
		chat.sends[0]!.reject(new Error('refused'));
		await settleWork();

		expect(remountedA.text()).toBe('from A\n\nnewer A');
		expect(remountedA.attachments()).toEqual(['a']);
		expect(keys(chat.store!.readThread('thread-b'))).toEqual(['b']);
		expect(chat.drafts!.getDraft('thread-b')).toBe('');
	});

	it('stores a refusal that arrives while another thread is on screen for the return', async () => {
		const chat = chatSurface();
		const a = await chat.open('thread-a');
		await a.send('from A', 'a');
		await a.close();
		const b = await chat.open('thread-b');
		await b.type('typed in B');
		b.context.addAttachments([file('b')]);

		chat.sends[0]!.reject(new Error('refused'));
		await settleWork();
		expect(b.text()).toBe('typed in B');
		expect(b.attachments()).toEqual(['b']);
		await b.close();

		const remountedA = await chat.open('thread-a');
		expect(remountedA.text()).toBe('from A');
		expect(remountedA.attachments()).toEqual(['a']);
	});

	it('binds a new conversation that gets its id after its composer unmounted', async () => {
		const chat = chatSurface();
		const created = Promise.withResolvers<{ threadId: string }>();
		const message = Promise.withResolvers<never>();
		vi.spyOn(client, 'mutation').mockImplementation((reference) =>
			getFunctionName(reference) === 'aiChat/threads:createThread'
				? created.promise
				: message.promise
		);
		const core = new ChatCore({
			threadId: null,
			api: {
				createThread: api.aiChat.threads.createThread,
				sendMessage: api.aiChat.messages.sendMessage
			}
		});
		chat.onSend.mockImplementation(async (prompt) => {
			await core.sendMessage(client, prompt);
		});
		const composer = await chat.open(null, core);
		await composer.send('first words', 'a');
		await composer.close();

		created.resolve({ threadId: 'thread-created' });
		await settleWork();
		message.reject(new Error('refused'));
		await settleWork();

		expect(chat.drafts!.getDraft('thread-created')).toBe('first words');
		expect(keys(chat.store!.readThread('thread-created'))).toEqual(['a']);
		const reopened = await chat.open('thread-created', core);
		expect(reopened.text()).toBe('first words');
		expect(reopened.attachments()).toEqual(['a']);
	});
});

describe('surface lifetime', () => {
	it('persists a refusal that arrives after the surface unmounted', async () => {
		const name = `settlement-${crypto.randomUUID()}`;
		const chat = chatSurface({ name });
		const unmountSurface = chat.owner.mount();
		const composer = await chat.open('thread-a');
		await composer.send('late refusal', 'a');
		await composer.close();
		unmountSurface();

		chat.sends[0]!.reject(new Error('refused'));
		await settleWork();

		expect(composer.context.inputValue).toBe('');
		const next = chatSurface({ name });
		const reopened = await next.open('thread-a');
		expect(reopened.text()).toBe('late refusal');
		expect(reopened.attachments()).toEqual(['a']);
	});

	it('stores nothing once the session ended, even after the surface unregistered', async () => {
		const persisted = chatSurface();
		const unmountSurface = persisted.owner.mount();
		const composer = await persisted.open('thread-a');
		await composer.send('old session', 'b');
		await composer.close();
		unmountSurface();

		clearPersistedChatState();
		persisted.sends[0]!.reject(new Error('refused'));
		await settleWork();

		expect(persisted.drafts!.getDraft('thread-a')).toBe('');
		expect(persisted.store!.readThread('thread-a')).toEqual([]);
		const reopened = await persisted.open('thread-a');
		expect(reopened.text()).toBe('');
		expect(reopened.attachments()).toEqual([]);
	});

	it('gives a surface entered again its owner back until no send and no mount holds it', async () => {
		const name = `settlement-${crypto.randomUUID()}`;
		const left = leasedSurface(name);
		const composer = await left.chat.open('thread-a');
		await composer.send('open');
		await composer.close();
		left.lease.release();

		const entered = leasedSurface(name);
		expect(entered.chat.owner).toBe(left.chat.owner);
		entered.lease.release();
		left.chat.sends[0]!.resolve();
		await settleWork();

		expect(leasedSurface(name).chat.owner).not.toBe(left.chat.owner);
	});

	it('keeps an idle surface owner while any mount holds it', () => {
		const name = `settlement-${crypto.randomUUID()}`;
		const first = leasedSurface(name);
		const second = leasedSurface(name);
		first.lease.release();
		first.lease.release();
		const third = leasedSurface(name);
		expect(second.chat.owner).toBe(first.chat.owner);
		expect(third.chat.owner).toBe(first.chat.owner);

		second.lease.release();
		third.lease.release();
		expect(leasedSurface(name).chat.owner).not.toBe(first.chat.owner);
	});

	it('gives a surface a new owner once the session ended, while the old send keeps its cleanup', async () => {
		const name = `settlement-${crypto.randomUUID()}`;
		const before = leasedSurface(name, { persistent: false });
		const composer = await before.chat.open('thread-a');
		await composer.send('old session', 'a');

		clearPersistedChatState();
		const after = leasedSurface(name, { persistent: false });
		expect(after.chat.owner).not.toBe(before.chat.owner);
		await composer.close();
		before.lease.release();
		const reopened = await after.chat.open('thread-a');
		before.chat.sends[0]!.reject(new Error('refused'));
		await settleWork();

		expect(before.chat.release).toHaveBeenCalledExactlyOnceWith(fileA);
		expect(reopened.text()).toBe('');
		expect(reopened.attachments()).toEqual([]);
		expect([...before.chat.restorations, ...after.chat.restorations]).toEqual([]);
	});

	it('hands a surface that stays mounted the next owner, which outlives the session end and old leases', () => {
		const name = `settlement-${crypto.randomUUID()}`;
		const create = () => new ComposerSendCoordinator();
		const renewals: ComposerSendLease[] = [];
		const mounted = acquireComposerSendCoordinator(name, create, (next) => renewals.push(next));
		const kept = acquireComposerSendCoordinator(name, create);

		clearPersistedChatState();
		expect(renewals).toHaveLength(1);
		expect(renewals[0]!.owner).not.toBe(mounted.owner);
		kept.release();
		const entered = acquireComposerSendCoordinator(name, create);
		expect(entered.owner).toBe(renewals[0]!.owner);

		clearPersistedChatState();
		expect(renewals).toHaveLength(2);
		expect(renewals[1]!.owner).not.toBe(entered.owner);
		entered.release();
		const later = acquireComposerSendCoordinator(name, create);
		expect(later.owner).toBe(renewals[1]!.owner);
		later.release();
		renewals[1]!.release();
	});

	it('keeps customer and admin settlement apart for the same thread id', async () => {
		const customer = chatSurface({ name: 'support' });
		const admin = chatSurface({ name: 'admin-support' });
		const customerComposer = await customer.open('shared');
		const adminComposer = await admin.open('shared');
		await customerComposer.send('customer', 'c');
		await adminComposer.send('admin', 'd');
		await customerComposer.close();

		customer.sends[0]!.reject(new Error('refused'));
		await settleWork();
		expect(adminComposer.text()).toBe('');
		expect(admin.drafts!.getDraft('shared')).toBe('');

		admin.sends[0]!.reject(new Error('refused'));
		await settleWork();
		expect(adminComposer.text()).toBe('admin');
		expect(adminComposer.attachments()).toEqual(['d']);
		expect(customer.drafts!.getDraft('shared')).toBe('customer');
		expect(keys(customer.store!.readThread('shared'))).toEqual(['c']);
	});
});

describe.each([
	{ owner: 'registered', registered: true },
	{ owner: 'unregistered', registered: false }
])('sends of an ended session, $owner owner', ({ registered }) => {
	/** A surface without a store whose session ends with or without its composer on screen. */
	async function surfaceAcrossSessionEnd() {
		const chat = chatSurface({ persistent: false });
		const unmountSurface = chat.owner.mount();
		const composer = await chat.open('thread-a');
		return {
			chat,
			composer,
			async endSession() {
				if (!registered) {
					await composer.close();
					unmountSurface();
				}
				clearPersistedChatState();
				await tick();
			}
		};
	}

	it('releases the files of a late refusal once and restores nothing', async () => {
		const { chat, composer, endSession } = await surfaceAcrossSessionEnd();
		await composer.send('old session', 'a');
		await endSession();

		chat.sends[0]!.reject(new Error('refused'));
		await settleWork();

		expect(chat.release).toHaveBeenCalledExactlyOnceWith(fileA);
		expect(chat.restorations).toEqual([]);
		expect(composer.context.inputValue).toBe('');
		expect(composer.context.attachments).toEqual([]);
	});

	it('releases nothing and restores nothing for a late acceptance', async () => {
		const { chat, composer, endSession } = await surfaceAcrossSessionEnd();
		await composer.send('old session', 'a');
		await endSession();

		chat.sends[0]!.resolve();
		await settleWork();

		expect(chat.release).not.toHaveBeenCalled();
		expect(chat.restorations).toEqual([]);
		expect(composer.context.inputValue).toBe('');
	});

	it('releases a refusal that was waiting for its group once, and the accepted send nothing', async () => {
		const { chat, composer, endSession } = await surfaceAcrossSessionEnd();
		await composer.send('A', 'a');
		await composer.send('B', 'b');
		chat.sends[0]!.reject(new Error('refused'));
		await settleWork();
		expect(chat.release).not.toHaveBeenCalled();

		await endSession();
		chat.sends[1]!.resolve();
		await settleWork();

		expect(chat.release).toHaveBeenCalledExactlyOnceWith(fileA);
		expect(chat.restorations).toEqual([]);
		expect(composer.context.attachments).toEqual([]);
	});

	it('ignores a repeated outcome after the cleanup', async () => {
		const { chat, composer, endSession } = await surfaceAcrossSessionEnd();
		await composer.type('once');
		composer.context.addAttachments([file('a')]);
		const snapshot = composer.context.captureSendSnapshot();
		composer.context.clearInputForSend(snapshot);
		const settle = composer.context.beginSend(snapshot);
		composer.context.clearAttachmentsForSend(snapshot);
		await endSession();

		settle('refused');
		settle('refused');
		settle('accepted');
		await settleWork();

		expect(chat.release).toHaveBeenCalledExactlyOnceWith(fileA);
		expect(chat.restorations).toEqual([]);
	});
});

describe.each(['accepted', 'refused'] as const)(
	'an owner kept past its session end, the open send then %s',
	(outcome) => {
		it('releases a known refusal at the next session end and the open send once at most', async () => {
			const { chat, lease } = leasedSurface(`settlement-${crypto.randomUUID()}`, {
				persistent: false
			});
			const composer = await chat.open('thread-a');
			clearPersistedChatState();
			await tick();

			await composer.send('A', 'a');
			await composer.type('B');
			composer.context.addAttachments([file('b')]);
			const snapshot = composer.context.captureSendSnapshot();
			composer.context.clearInputForSend(snapshot);
			const settleB = composer.context.beginSend(snapshot);
			composer.context.clearAttachmentsForSend(snapshot);
			chat.sends[0]!.reject(new Error('refused'));
			await settleWork();
			expect(chat.release).not.toHaveBeenCalled();

			clearPersistedChatState();
			await tick();
			expect(chat.release).toHaveBeenCalledExactlyOnceWith(fileA);

			settleB(outcome);
			settleB('refused');
			settleB('accepted');
			await settleWork();

			const released = outcome === 'refused' ? [[fileA], [fileB]] : [[fileA]];
			expect(chat.release.mock.calls).toEqual(released);
			expect(chat.restorations).toEqual([]);
			lease.release();
		});
	}
);

describe('sent attachments', () => {
	it('takes the files of a send refused on the spot out of the composer until its group settles', async () => {
		const chat = chatSurface({ persistent: false });
		const composer = await chat.open('thread-a');
		await composer.send('A', 'a');
		chat.onSend.mockImplementationOnce(() => {
			throw new Error('refused before sending');
		});
		await composer.send('B', 'b');
		await settleWork();

		expect(composer.text()).toBe('');
		expect(composer.attachments()).toEqual([]);
		expect(chat.release).not.toHaveBeenCalled();

		chat.sends[0]!.reject(new Error('refused'));
		await settleWork();
		expect(composer.text()).toBe('A\n\nB');
		expect(composer.attachments()).toEqual(['a', 'b']);
		expect(chat.restorations).toEqual(['A\n\nB']);
		expect(chat.release).not.toHaveBeenCalled();

		composer.context.removeAttachment(1);
		await tick();
		expect(chat.release).toHaveBeenCalledExactlyOnceWith(fileB);
		expect(composer.attachments()).toEqual(['a']);
	});

	it('gives nothing back to the transport when the send is accepted', async () => {
		const chat = chatSurface({ persistent: false });
		const composer = await chat.open('thread-a');
		await composer.send('accepted', 'a');
		expect(composer.attachments()).toEqual([]);

		chat.sends[0]!.resolve();
		await settleWork();
		await composer.close();

		expect(chat.release).not.toHaveBeenCalled();
	});

	it('returns refused attachments to the composer on screen without releasing them', async () => {
		const chat = chatSurface({ persistent: false });
		const composer = await chat.open('thread-a');
		await composer.send('refused', 'a');

		chat.sends[0]!.reject(new Error('refused'));
		await settleWork();
		expect(composer.attachments()).toEqual(['a']);
		expect(chat.release).not.toHaveBeenCalled();

		composer.context.removeAttachment(0);
		expect(chat.release).toHaveBeenCalledExactlyOnceWith({
			fileId: 'file-a',
			url: 'https://chat.test/a.txt'
		});
	});

	it('stores refused attachments of a thread that is off screen', async () => {
		const chat = chatSurface();
		const composer = await chat.open('thread-a');
		await composer.send('refused', 'a');
		await composer.close();

		chat.sends[0]!.reject(new Error('refused'));
		await settleWork();

		expect(keys(chat.store!.readThread('thread-a'))).toEqual(['a']);
		const reopened = await chat.open('thread-a');
		expect(reopened.attachments()).toEqual(['a']);
	});

	it('releases refused attachments once when nothing keeps them, and never offers them again', async () => {
		const chat = chatSurface({ persistent: false });
		const composer = await chat.open('thread-a');
		await composer.send('refused', 'a');
		await composer.close();

		chat.sends[0]!.reject(new Error('refused'));
		await settleWork();
		expect(chat.release).toHaveBeenCalledExactlyOnceWith({
			fileId: 'file-a',
			url: 'https://chat.test/a.txt'
		});

		const reopened = await chat.open('thread-a');
		expect(reopened.text()).toBe('');
		expect(reopened.attachments()).toEqual([]);
		await reopened.close();
		expect(chat.release).toHaveBeenCalledOnce();
	});
});

describe('restored work past the message limits', () => {
	it('keeps two full-length refusals whole and blocks sending until the text is shortened', async () => {
		const chat = chatSurface();
		const composer = await chat.open('thread-a');
		const first = 'a'.repeat(MAX_MESSAGE_LENGTH);
		const second = 'b'.repeat(MAX_MESSAGE_LENGTH);
		await composer.send(first);
		await composer.send(second);
		chat.sends[0]!.reject(new Error('refused'));
		chat.sends[1]!.reject(new Error('refused'));
		await settleWork();

		expect(composer.text()).toBe(`${first}\n\n${second}`);
		expect(composer.notice()?.textContent).toContain(
			en.chat.notices.message_too_long.replace('{max}', String(MAX_MESSAGE_LENGTH))
		);
		expect(composer.button().disabled).toBe(true);
		composer.button().click();
		await composer.enter();
		expect(chat.onSend).toHaveBeenCalledTimes(2);

		await composer.type(second);
		expect(composer.notice()).toBeNull();
		expect(composer.button().disabled).toBe(false);
		await composer.enter();
		expect(chat.onSend).toHaveBeenCalledTimes(3);
	});

	it('keeps every file of a full refusal plus a later pick and blocks sending until one goes', async () => {
		const profile: UploadProfile = { ...DEFAULT_ATTACHMENT_PROFILE, maxFiles: 20 };
		const chat = chatSurface({ profile });
		const composer = await chat.open('thread-a');
		const twenty = Array.from({ length: 20 }, (_, index) => `file-${index}`);
		await composer.send('twenty files', ...twenty);
		composer.context.addAttachments([file('later')]);
		chat.sends[0]!.reject(new Error('refused'));
		await settleWork();

		expect(composer.attachments()).toEqual([...twenty, 'later']);
		expect(composer.text()).toBe('twenty files');
		expect(composer.notice()?.textContent).toContain(
			en.chat.notices.too_many_attachments.replace('{max}', '20')
		);
		expect(composer.button().disabled).toBe(true);
		composer.button().click();
		await composer.enter();
		expect(chat.onSend).toHaveBeenCalledOnce();

		composer.context.removeAttachment(20);
		await tick();
		expect(composer.notice()).toBeNull();
		expect(composer.button().disabled).toBe(false);
		composer.button().click();
		await tick();
		expect(chat.onSend).toHaveBeenCalledTimes(2);
	});
});
