/**
 * Send settlement through the real composer.
 *
 * Every composer here is a real ChatInput over a real ChatUIContext. A remount
 * disposes the context and builds a new one on the same composer, the way a
 * keyed surface does.
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
import { ChatComposer, chatComposerFor } from './chat-composer.svelte.ts';
import ChatTestProvider from './test-fixtures/ChatTestProvider.svelte';
import ChatInputHarness from './test-fixtures/ChatInputHarness.svelte';
import en from '../../../i18n/en.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('svelte/reactivity', () => import('./test-fixtures/client-reactivity.ts'));
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
 * One chat surface: a composer shared by every view it mounts.
 *
 * `persistent` surfaces have a draft store and upload directly to storage with an
 * attachment store. They store typing only when a view moves to another
 * conversation, as the support widget does, so a stored draft here is one a send
 * or a refusal wrote. The other kind uses its own transport with `release` and
 * keeps nothing. `drafts` reads the surface's stored drafts.
 */
function chatSurface({
	persistent = true,
	profile,
	name = `settlement-${crypto.randomUUID()}`,
	showFileButton = false,
	owner: givenOwner
}: {
	persistent?: boolean;
	profile?: UploadProfile;
	name?: string;
	showFileButton?: boolean;
	owner?: () => ChatComposer;
} = {}) {
	const drafts = persistent ? new ChatDraftManager(name) : undefined;
	const store = persistent ? new ChatAttachmentStore(name) : undefined;
	const release = vi.fn();
	const uploadConfig: UploadConfig = persistent
		? { purpose: 'aiChat', profile }
		: { upload: vi.fn(), release, profile };
	const owner =
		givenOwner?.() ??
		(persistent
			? new ChatComposer({ surface: name, saveDrafts: 'on-switch', storeFiles: true })
			: new ChatComposer({ saveDrafts: 'on-switch' }));
	const sends: Send[] = [];
	const onSend = vi.fn((prompt: string): Promise<void> => {
		const send = Object.assign(Promise.withResolvers<void>(), { prompt });
		sends.push(send);
		return send.promise;
	});

	async function openComposer(threadId: string | null, core = new ChatCore({ threadId })) {
		const context = new ChatUIContext(core, client, owner, uploadConfig);
		const target = document.body.appendChild(document.createElement('div'));
		const contentProps = { context, onSend, showFileButton };
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
			atAttachmentCap: () =>
				target
					.querySelector(`button[aria-label="${en.chat.tooltip.attach_files}"]`)
					?.getAttribute('aria-disabled') === 'true',
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

	/** What a surface keyed by the composer's session does at its end: a new view, then the old one goes. */
	async function remount(view: Awaited<ReturnType<typeof openComposer>>) {
		const next = await openComposer(view.core.threadId, view.core);
		await view.close();
		return next;
	}

	return { owner, drafts, store, release, sends, onSend, open: openComposer, remount };
}

/** A surface whose composer comes from the document's registry, the way a page gets it. */
function registeredSurface(name: string, options: { persistent?: boolean } = {}) {
	return chatSurface({
		...options,
		name,
		owner: () => chatComposerFor(name, { storeFiles: options.persistent ?? true })
	});
}

/** The listeners `core`'s conversation will call when it receives its thread id. */
function assignmentListeners(core: ChatCore): Set<(threadId: string) => void> {
	const listening = new Set<(threadId: string) => void>();
	const whenAssigned = core.conversation.whenAssigned.bind(core.conversation);
	vi.spyOn(core.conversation, 'whenAssigned').mockImplementation((listener) => {
		listening.add(listener);
		const unsubscribe = whenAssigned(listener);
		return () => {
			listening.delete(listener);
			unsubscribe();
		};
	});
	return listening;
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
	// A composer left with an open send would otherwise reach the next test.
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

		chat.sends[1]!.reject(new Error('refused'));
		await settleWork();
		expect(composer.text()).toBe('A\n\nB\n\nnewer');
		expect(composer.attachments()).toEqual(['a', 'b']);
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

	it.each(['on-switch', 'while-typing'] as const)(
		'keeps the follow-up of a new conversation left before its send assigned the id, saving %s',
		async (saveDrafts) => {
			const name = `settlement-${crypto.randomUUID()}`;
			const chat = chatSurface({
				name,
				owner: () => new ChatComposer({ surface: name, saveDrafts, storeFiles: true })
			});
			const core = new ChatCore({ threadId: null });
			const composer = await chat.open(null, core);
			await composer.send('first words');
			await composer.type('follow-up');
			const { conversation } = core;
			core.setThread('thread-b');
			await tick();
			expect(composer.text()).toBe('');

			conversation.assign('thread-created');
			await settleWork();
			expect(chat.drafts!.getDraft('thread-created')).toBe('follow-up');
			core.setThread('thread-created');
			await tick();
			expect(composer.text()).toBe('follow-up');

			chat.sends[0]!.resolve();
			await settleWork();
			expect(composer.text()).toBe('follow-up');
			expect(chat.drafts!.getDraft('thread-created')).toBe('follow-up');
		}
	);

	describe.each(['on-switch', 'while-typing'] as const)(
		'a refused new conversation, saving %s',
		(saveDrafts) => {
			const surface = () => {
				const name = `settlement-${crypto.randomUUID()}`;
				return chatSurface({
					name,
					owner: () => new ChatComposer({ surface: name, saveDrafts, storeFiles: true })
				});
			};

			it('keeps the refused text after its view moves on, until the id arrives', async () => {
				const chat = surface();
				const core = new ChatCore({ threadId: null });
				const composer = await chat.open(null, core);
				await composer.send('first words');
				chat.sends[0]!.reject(new Error('refused'));
				await settleWork();
				expect(composer.text()).toBe('first words');

				const { conversation } = core;
				core.setThread('thread-b');
				await tick();
				conversation.assign('thread-created');
				await settleWork();

				expect(chat.drafts!.getDraft('thread-created')).toBe('first words');
				core.setThread('thread-created');
				await tick();
				expect(composer.text()).toBe('first words');
			});

			it('keeps the refused text across a remount that took its files, until the id arrives', async () => {
				const chat = surface();
				const core = new ChatCore({ threadId: null });
				const composer = await chat.open(null, core);
				await composer.send('first words', 'a');
				await composer.close();
				chat.sends[0]!.reject(new Error('refused'));
				await settleWork();

				const remounted = await chat.open(null, core);
				expect(remounted.text()).toBe('first words');
				expect(remounted.attachments()).toEqual(['a']);
				await remounted.close();
				core.conversation.assign('thread-created');
				await settleWork();

				expect(chat.drafts!.getDraft('thread-created')).toBe('first words');
				const reopened = await chat.open('thread-created', core);
				expect(reopened.text()).toBe('first words');
			});
		}
	);

	it('stops waiting for the id of a refused new conversation on a surface without drafts', async () => {
		const chat = chatSurface({ persistent: false });
		const core = new ChatCore({ threadId: null });
		const listening = assignmentListeners(core);
		const composer = await chat.open(null, core);
		await composer.send('first words');
		await composer.type('follow-up');
		await composer.close();
		expect(listening.size).toBe(1);

		chat.sends[0]!.reject(new Error('refused'));
		await settleWork();

		expect(listening.size).toBe(0);
	});

	it('stores a refusal that arrived before its new conversation got an id', async () => {
		const chat = chatSurface();
		const core = new ChatCore({ threadId: null });
		const composer = await chat.open(null, core);
		await composer.send('held words', 'a');
		await composer.close();
		chat.sends[0]!.reject(new Error('refused'));
		await settleWork();

		core.conversation.assign('thread-created');
		await settleWork();

		expect(chat.drafts!.getDraft('thread-created')).toBe('held words');
		expect(keys(chat.store!.readThread('thread-created'))).toEqual(['a']);
		const reopened = await chat.open('thread-created', core);
		expect(reopened.text()).toBe('held words');
		expect(reopened.attachments()).toEqual(['a']);
	});
});

describe('text of a thread across views', () => {
	it('shows the text a surface composer holds to a view mounted later, and follows it', async () => {
		const chat = registeredSurface(`settlement-${crypto.randomUUID()}`);
		const first = await chat.open('thread-a');
		await first.type('typed before');

		const later = await chat.open('thread-a');
		expect(later.text()).toBe('typed before');
		await first.type('typed after');
		expect(later.text()).toBe('typed after');
	});

	it('shows the draft another tab stored while the thread was off screen', async () => {
		const name = `settlement-${crypto.randomUUID()}`;
		const chat = chatSurface({
			name,
			owner: () => new ChatComposer({ surface: name, storeFiles: true })
		});
		const core = new ChatCore({ threadId: 'thread-a' });
		const composer = await chat.open('thread-a', core);
		await composer.type('typed here');
		expect(chat.drafts!.getDraft('thread-a')).toBe('typed here');
		core.setThread('thread-b');
		await tick();

		const stored = JSON.stringify({ 'thread-a': 'typed in another tab' });
		localStorage.setItem(`drafts:${name}`, stored);
		window.dispatchEvent(new StorageEvent('storage', { key: `drafts:${name}`, newValue: stored }));
		core.setThread('thread-a');
		await tick();

		expect(composer.text()).toBe('typed in another tab');
	});

	describe.each([
		{ opened: 'on the thread', start: 'thread-a' },
		{ opened: 'on another thread and moved to it', start: 'thread-b' }
	])('a second support view opened $opened', ({ start }) => {
		it.each(['first', 'second'] as const)(
			'shows the unsaved text of the first view and keeps it after the %s view closes',
			async (closing) => {
				const chat = chatSurface({ name: `support-${crypto.randomUUID()}` });
				chat.drafts!.setDraft('thread-a', 'stored earlier');
				const first = await chat.open('thread-a');
				expect(first.text()).toBe('stored earlier');
				await first.type('unsaved');

				const core = new ChatCore({ threadId: start });
				const second = await chat.open(start, core);
				if (start !== 'thread-a') {
					core.setThread('thread-a');
					await tick();
				}
				expect(second.text()).toBe('unsaved');
				expect(first.text()).toBe('unsaved');
				expect(chat.drafts!.getDraft('thread-a')).toBe('stored earlier');

				const [closed, kept] = closing === 'first' ? [first, second] : [second, first];
				await closed.close();
				expect(kept.text()).toBe('unsaved');
				await kept.type('unsaved, then more');
				expect(kept.text()).toBe('unsaved, then more');
			}
		);
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

	it('keeps a held refusal of a left surface for its next mount', async () => {
		const name = `settlement-${crypto.randomUUID()}`;
		const left = registeredSurface(name);
		const core = new ChatCore({ threadId: null });
		const composer = await left.open(null, core);
		await composer.send('held words', 'a');
		await composer.close();
		left.sends[0]!.reject(new Error('refused'));
		await settleWork();

		const reopened = await registeredSurface(name).open(null, core);
		expect(reopened.attachments()).toEqual(['a']);
	});

	it('stores a held refusal of a left surface once its id arrives', async () => {
		const name = `settlement-${crypto.randomUUID()}`;
		const left = registeredSurface(name);
		const core = new ChatCore({ threadId: null });
		const composer = await left.open(null, core);
		await composer.send('held words', 'a');
		await composer.close();
		left.sends[0]!.reject(new Error('refused'));
		await settleWork();

		core.conversation.assign('thread-created');
		await settleWork();

		expect(left.drafts!.getDraft('thread-created')).toBe('held words');
		expect(keys(left.store!.readThread('thread-created'))).toEqual(['a']);
	});

	it('lets go of a held refusal of a left surface when the session ends', async () => {
		const name = `settlement-${crypto.randomUUID()}`;
		const left = registeredSurface(name);
		const core = new ChatCore({ threadId: null });
		const listening = assignmentListeners(core);
		const composer = await left.open(null, core);
		await composer.send('old session', 'a');
		await composer.close();
		left.sends[0]!.reject(new Error('refused'));
		await settleWork();
		expect(listening.size).toBe(1);

		clearPersistedChatState();
		expect(listening.size).toBe(0);
		core.conversation.assign('thread-created');
		await settleWork();

		expect(left.drafts!.getDraft('thread-created')).toBe('');
		expect(left.store!.readThread('thread-created')).toEqual([]);
		const reopened = await registeredSurface(name).open('thread-created', core);
		expect(reopened.text()).toBe('');
		expect(reopened.attachments()).toEqual([]);
	});

	it('serves the next session from the same surface, while the old send keeps its cleanup', async () => {
		const chat = registeredSurface(`settlement-${crypto.randomUUID()}`, { persistent: false });
		const composer = await chat.open('thread-a');
		await composer.send('old session', 'a');

		clearPersistedChatState();
		await composer.close();
		const reopened = await chat.open('thread-a');
		expect(reopened.text()).toBe('');
		expect(reopened.attachments()).toEqual([]);
		await reopened.send('new session');
		expect(chat.onSend).toHaveBeenLastCalledWith('new session');

		chat.sends[0]!.reject(new Error('refused'));
		await settleWork();
		expect(chat.release).toHaveBeenCalledExactlyOnceWith(fileA);
		expect(reopened.text()).toBe('');
		expect(reopened.attachments()).toEqual([]);

		chat.sends[1]!.reject(new Error('refused'));
		await settleWork();
		expect(reopened.text()).toBe('new session');
		expect(reopened.attachments()).toEqual([]);
		expect(chat.release).toHaveBeenCalledOnce();
	});

	it('sends, restores and cleans up after each of two session ends on a surface that stays mounted', async () => {
		const chat = registeredSurface(`settlement-${crypto.randomUUID()}`, { persistent: false });
		let composer = await chat.open('thread-a');

		for (const [round, attached] of ['a', 'b'].entries()) {
			await composer.send(`old ${round}`, attached);
			clearPersistedChatState();
			composer = await chat.remount(composer);
			expect(composer.text()).toBe('');
			expect(composer.attachments()).toEqual([]);

			await composer.send(`new ${round}`);
			chat.sends.at(-1)!.reject(new Error('refused'));
			await settleWork();
			expect(composer.text()).toBe(`new ${round}`);

			chat.sends.at(-2)!.reject(new Error('refused'));
			await settleWork();
			expect(composer.text()).toBe(`new ${round}`);
			expect(composer.attachments()).toEqual([]);
			await composer.type('');
		}

		expect(chat.release.mock.calls).toEqual([[fileA], [fileB]]);
	});

	it('sends nothing for a click in the same tick as the session end, then only the text of the next session', async () => {
		const chat = registeredSurface(`settlement-${crypto.randomUUID()}`);
		const ended = await chat.open('thread-a');
		await ended.send('open before the end');
		await ended.type('typed before the end');

		clearPersistedChatState();
		ended.button().click();
		await settleWork();
		expect(chat.onSend).toHaveBeenCalledOnce();

		const composer = await chat.remount(ended);
		chat.sends[0]!.reject(new Error('refused'));
		await settleWork();
		await composer.send('next session');
		expect(chat.onSend).toHaveBeenLastCalledWith('next session');
		chat.sends[1]!.reject(new Error('refused'));
		await settleWork();
		expect(composer.text()).toBe('next session');
		expect(chat.drafts!.getDraft('thread-a')).toBe('next session');
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
		let onScreen = composer;
		return {
			chat,
			composer,
			onScreen: () => onScreen,
			async endSession() {
				if (!registered) {
					await composer.close();
					unmountSurface();
				}
				clearPersistedChatState();
				await tick();
				if (!registered) onScreen = await chat.open('thread-a');
			}
		};
	}

	it('releases the files of a late refusal once and restores nothing', async () => {
		const { chat, composer, onScreen, endSession } = await surfaceAcrossSessionEnd();
		await composer.send('old session', 'a');
		await endSession();

		chat.sends[0]!.reject(new Error('refused'));
		await settleWork();

		expect(chat.release).toHaveBeenCalledExactlyOnceWith(fileA);
		expect(onScreen().text()).toBe('');
		expect(onScreen().attachments()).toEqual([]);
		expect(composer.context.inputValue).toBe('');
		expect(composer.context.attachments).toEqual([]);
	});

	it('releases nothing and restores nothing for a late acceptance', async () => {
		const { chat, composer, onScreen, endSession } = await surfaceAcrossSessionEnd();
		await composer.send('old session', 'a');
		await endSession();

		chat.sends[0]!.resolve();
		await settleWork();

		expect(chat.release).not.toHaveBeenCalled();
		expect(onScreen().text()).toBe('');
		expect(onScreen().attachments()).toEqual([]);
		expect(composer.context.inputValue).toBe('');
	});

	it('releases a refusal that was waiting for its group once, and the accepted send nothing', async () => {
		const { chat, composer, onScreen, endSession } = await surfaceAcrossSessionEnd();
		await composer.send('A', 'a');
		await composer.send('B', 'b');
		chat.sends[0]!.reject(new Error('refused'));
		await settleWork();
		expect(chat.release).not.toHaveBeenCalled();

		await endSession();
		chat.sends[1]!.resolve();
		await settleWork();

		expect(chat.release).toHaveBeenCalledExactlyOnceWith(fileA);
		expect(onScreen().text()).toBe('');
		expect(onScreen().attachments()).toEqual([]);
		expect(composer.context.attachments).toEqual([]);
	});

	it('ignores a repeated outcome after the cleanup', async () => {
		const { chat, composer, onScreen, endSession } = await surfaceAcrossSessionEnd();
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
		expect(onScreen().text()).toBe('');
		expect(onScreen().attachments()).toEqual([]);
	});
});

describe.each(['accepted', 'refused'] as const)(
	'a surface composer kept past its session end, the open send then %s',
	(outcome) => {
		it('releases a known refusal at the next session end and the open send once at most', async () => {
			const chat = registeredSurface(`settlement-${crypto.randomUUID()}`, { persistent: false });
			let composer = await chat.open('thread-a');
			clearPersistedChatState();
			composer = await chat.remount(composer);

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
			composer = await chat.remount(composer);
			expect(chat.release).toHaveBeenCalledExactlyOnceWith(fileA);

			settleB(outcome);
			settleB('refused');
			settleB('accepted');
			await settleWork();

			const released = outcome === 'refused' ? [[fileA], [fileB]] : [[fileA]];
			expect(chat.release.mock.calls).toEqual(released);
			expect(composer.text()).toBe('');
			expect(composer.attachments()).toEqual([]);
		});
	}
);

describe.each(['accepted', 'refused'] as const)(
	'a surface composer whose send outlives its session, then %s',
	(outcome) => {
		it('holds no files after the session end, and releases at most once', async () => {
			const chat = registeredSurface(`settlement-${crypto.randomUUID()}`, { persistent: false });
			const composer = await chat.open('thread-a');
			await composer.send('old session', 'a');
			expect(chat.owner.pendingAttachmentCount(composer.context)).toBe(1);

			clearPersistedChatState();
			await tick();
			expect(chat.owner.pendingAttachmentCount(composer.context)).toBe(0);

			if (outcome === 'refused') chat.sends[0]!.reject(new Error('refused'));
			else chat.sends[0]!.resolve();
			await settleWork();

			expect(chat.release.mock.calls).toEqual(outcome === 'refused' ? [[fileA]] : []);
			expect(composer.text()).toBe('');
			expect(composer.attachments()).toEqual([]);
		});
	}
);

describe('a surface composer kept past its session end with a send still open', () => {
	it('restores a refusal of the next session at once and releases the old files on their refusal', async () => {
		const chat = registeredSurface(`settlement-${crypto.randomUUID()}`, { persistent: false });
		let composer = await chat.open('thread-a');
		await composer.send('old session', 'a');
		clearPersistedChatState();
		composer = await chat.remount(composer);

		await composer.send('next session');
		chat.sends[1]!.reject(new Error('refused'));
		await settleWork();
		expect(composer.text()).toBe('next session');

		chat.sends[0]!.reject(new Error('refused'));
		await settleWork();
		expect(chat.release).toHaveBeenCalledExactlyOnceWith(fileA);
		expect(composer.text()).toBe('next session');
	});
});

describe.each(['refused', 'accepted'] as const)(
	'a view of an ended session kept by its caller, its send then %s',
	(outcome) => {
		it('sends nothing into the view of the next session', async () => {
			const chat = registeredSurface(`settlement-${crypto.randomUUID()}`);
			const ended = await chat.open('thread-a');
			clearPersistedChatState();
			const next = await chat.open('thread-a', ended.core);
			await next.type('new text');
			next.context.addAttachments([file('new')]);
			await tick();
			const unchanged = (text: string) => {
				expect(next.text()).toBe(text);
				expect(next.attachments()).toEqual(['new']);
				expect(chat.owner.pendingAttachmentCount(next.context)).toBe(0);
				expect(chat.drafts!.getDraft('thread-a')).toBe(text);
				expect(keys(chat.store!.readThread('thread-a'))).toEqual(['new']);
			};

			const snapshot = ended.context.captureSendSnapshot();
			ended.context.clearInputForSend(snapshot);
			const settle = ended.context.beginSend(snapshot);
			ended.context.clearAttachmentsForSend(snapshot);
			expect(ended.context.isSendSnapshotCurrent(snapshot)).toBe(false);
			unchanged('new text');

			await next.send('next send');
			chat.sends[0]!.reject(new Error('refused'));
			await settleWork();
			unchanged('next send');

			settle(outcome);
			await settleWork();
			unchanged('next send');
		});
	}
);

/** What another tab does when its session ends: empty the stores, then say so. */
function endSessionInAnotherTab(...storageKeys: string[]): void {
	for (const key of storageKeys) {
		localStorage.setItem(key, '{}');
		window.dispatchEvent(new StorageEvent('storage', { key, newValue: '{}' }));
	}
	const ended = crypto.randomUUID();
	localStorage.setItem('chat:session-ended', ended);
	window.dispatchEvent(new StorageEvent('storage', { key: 'chat:session-ended', newValue: ended }));
}

describe.each(['in this tab', 'in another tab'] as const)('a session that ends %s', (where) => {
	it('leaves no old draft or file of a shown or an off-screen thread, and stores only new work', async () => {
		const name = `settlement-${crypto.randomUUID()}`;
		const draftsKey = `drafts:${name}`;
		const filesKey = `attachments:${name}`;
		const chat = registeredSurface(name);
		const stored = () => ({
			drafts: { ...chat.drafts!.drafts.current },
			files: Object.fromEntries(
				[...chat.store!.read()].map(([thread, files]) => [thread, keys(files)])
			)
		});
		const offScreen = await chat.open('thread-b');
		await offScreen.type('old draft b');
		offScreen.context.addAttachments([file('b')]);
		await offScreen.close();
		const shown = await chat.open('thread-a');
		await shown.type('old draft a');
		shown.context.addAttachments([file('a')]);
		await tick();
		const before = {
			drafts: { 'thread-a': 'old draft a', 'thread-b': 'old draft b' },
			files: { 'thread-a': ['a'], 'thread-b': ['b'] }
		};
		expect(stored()).toEqual(before);

		if (where === 'in this tab') {
			const forget = chat.owner.forgetPersistedState.bind(chat.owner);
			let atEntry: unknown;
			let atReturn: unknown;
			vi.spyOn(chat.owner, 'forgetPersistedState').mockImplementation(() => {
				atEntry = [localStorage.getItem(draftsKey), localStorage.getItem(filesKey)];
				forget();
				atReturn = stored();
			});
			clearPersistedChatState();
			const [draftsAtEntry, filesAtEntry] = atEntry as [string, string];
			expect(JSON.parse(draftsAtEntry)).toEqual(before.drafts);
			expect(Object.keys(JSON.parse(filesAtEntry)).sort()).toEqual(['thread-a', 'thread-b']);
			expect(atReturn).toEqual({ drafts: {}, files: {} });
		} else {
			endSessionInAnotherTab(draftsKey, filesKey);
		}
		await tick();

		expect(shown.text()).toBe('');
		expect(shown.attachments()).toEqual([]);
		await shown.close();
		const returned = await chat.open('thread-b');
		expect(returned.text()).toBe('');
		expect(returned.attachments()).toEqual([]);
		await returned.close();
		const next = await chat.open('thread-a');
		expect(next.text()).toBe('');
		expect(next.attachments()).toEqual([]);

		await next.type('new draft');
		next.context.addAttachments([file('new')]);
		await tick();
		expect(stored()).toEqual({
			drafts: { 'thread-a': 'new draft' },
			files: { 'thread-a': ['new'] }
		});
	});
});

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
		expect(chat.release).not.toHaveBeenCalled();

		composer.context.removeAttachment(1);
		await tick();
		expect(chat.release).toHaveBeenCalledExactlyOnceWith(fileB);
		expect(composer.attachments()).toEqual(['a']);
	});

	it('frees the files of an accepted send at the cap while the rest of its group is open', async () => {
		const profile: UploadProfile = { ...DEFAULT_ATTACHMENT_PROFILE, maxFiles: 2 };
		const chat = chatSurface({ persistent: false, profile, showFileButton: true });
		const composer = await chat.open('thread-a');
		await composer.send('A', 'a');
		await composer.send('B', 'b');
		expect(composer.atAttachmentCap()).toBe(true);

		chat.sends[0]!.resolve();
		await settleWork();
		expect(composer.atAttachmentCap()).toBe(false);
		expect(chat.owner.pendingAttachmentCount(composer.context)).toBe(1);

		chat.sends[1]!.reject(new Error('refused'));
		await settleWork();
		expect(composer.text()).toBe('B');
		expect(composer.attachments()).toEqual(['b']);
		expect(chat.release).not.toHaveBeenCalled();
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
