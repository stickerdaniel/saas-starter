/**
 * Send settlement across leaving a whole chat page and entering it again,
 * through the real AI chat and admin support pages and their composer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount, type Component } from 'svelte';
import type * as Svelte from 'svelte';
import { ConvexClient } from 'convex/browser';
import { getFunctionName, type FunctionReference } from 'convex/server';
import { api } from '#lib/convex/_generated/api.js';
import { clearPersistedChatState } from '../core/chat-persisted-state.ts';
import type { Attachment } from '../core/types.js';
import { ChatUIContext } from './chat-context.svelte.ts';
import { SupportContext } from '../../components/customer-support/support-context.svelte.ts';
import ChatTestProvider from './test-fixtures/ChatTestProvider.svelte';
import AIChatPage from '../../../routes/[[lang]]/app/ai-chat/+page.svelte';
import AdminSupportPage from '../../../routes/[[lang]]/admin/support/+page.svelte';
import CustomerSupport from '../../components/customer-support/customer-support.svelte';
import en from '../../../i18n/en.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

const page = vi.hoisted(() => ({
	url: new URL('https://example.com/en'),
	params: { lang: 'en' },
	data: { lang: 'en' } as Record<string, unknown>
}));

vi.mock('$app/state', () => ({ page }));
vi.mock('$app/env', () => ({ browser: true, dev: true, building: false }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), afterNavigate: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('runed/kit', () => ({
	useSearchParams: () => ({ mode: 'all', status: 'open', search: '' })
}));
vi.mock('@stickerdaniel/convex-autumn-svelte/sveltekit', () => ({
	useCustomer: () => ({
		customer: {
			products: [],
			features: { ai_chat_messages: { balance: 5, included_usage: 10 } }
		},
		refetch: vi.fn()
	})
}));
vi.mock('#lib/components/billing/index.js', () => ({
	useBillingCheckout: () => ({ start: vi.fn(), isLoading: false })
}));
vi.mock('#lib/auth-client.js', () => ({
	authClient: {
		useSession: () => ({
			subscribe: (callback: (value: { data: null; isPending: false }) => void) => {
				callback({ data: null, isPending: false });
				return () => {};
			}
		}),
		admin: { checkRolePermission: () => false }
	}
}));
vi.mock('@mmailaender/convex-better-auth-svelte/svelte', () => ({
	useAuth: () => ({ isAuthenticated: false, isLoading: false })
}));
vi.mock('#lib/components/customer-support/use-support-url-state.svelte.ts', () => ({
	useSupportUrlState: () => ({ support: 'open', thread: 'thread-a' })
}));
vi.mock('#lib/components/customer-support/threads-overview.svelte', () => ({ default: () => {} }));
vi.mock('#lib/hooks/use-media.svelte.ts', () => ({
	useMedia: () => ({ sm: true, lg: false, xl: false })
}));
vi.mock('#lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('#lib/components/SEOHead.svelte', () => ({ default: () => {} }));
vi.mock('#lib/chat/ui/ChatMessages.svelte', () => ({ default: () => {} }));
vi.mock('#lib/chat/ui/ChatAttachments.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/message-quota-banner.svelte', () => ({ default: () => {} }));
vi.mock('../../../routes/[[lang]]/admin/support/thread-list.svelte', () => ({
	default: () => {}
}));
vi.mock('../../../routes/[[lang]]/admin/support/thread-details.svelte', () => ({
	default: () => {}
}));
vi.mock('#lib/components/ui/sheet/index.js', () => ({ Root: () => {}, Content: () => {} }));

let component: ReturnType<typeof mount> | undefined;
let client: ConvexClient;
const originalElementAnimate = Element.prototype.animate;

// The support page also renders its separate AI chatbar, faded out while the widget is open.
const composer = <E extends Element>(selector: string): E =>
	[...document.querySelectorAll<E>(selector)].find((element) => !element.closest('.ai-chatbar'))!;
const textarea = () => composer<HTMLTextAreaElement>('textarea');
const sendButton = () => composer<HTMLButtonElement>(`button[aria-label="${en.chat.aria.send}"]`);

async function type(value: string): Promise<void> {
	textarea().value = value;
	textarea().dispatchEvent(new Event('input', { bubbles: true }));
	await tick();
}

async function send(value: string): Promise<void> {
	await type(value);
	expect(sendButton().disabled).toBe(false);
	sendButton().click();
	await tick();
}

async function settleWork(): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	await tick();
}

beforeEach(() => {
	localStorage.clear();
	Object.defineProperty(Element.prototype, 'animate', {
		configurable: true,
		value: vi.fn(() => ({ cancel: vi.fn(), finished: Promise.resolve() }))
	});
	client = new ConvexClient('https://page-owner-test.convex.cloud', { disabled: true });
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
	try {
		if (component) await unmount(component);
		component = undefined;
		// A page left with an open send keeps its owner, which must not reach the next test.
		clearPersistedChatState();
		await client.close();
		localStorage.clear();
		vi.restoreAllMocks();
	} finally {
		Object.defineProperty(Element.prototype, 'animate', {
			configurable: true,
			value: originalElementAnimate
		});
	}
});

describe.each([
	{
		name: 'AI chat',
		surface: 'ai-chat',
		path: '/en/app/ai-chat',
		Page: AIChatPage,
		reply: api.aiChat.messages.sendMessage,
		savesWhileTyping: true
	},
	{
		name: 'admin support',
		surface: 'admin-support',
		path: '/en/admin/support',
		Page: AdminSupportPage,
		reply: api.admin.support.mutations.sendAdminReply,
		savesWhileTyping: true
	},
	{
		// The widget stores a draft when its thread is left, not on every keystroke.
		name: 'customer support',
		surface: 'support',
		path: '/en',
		Page: CustomerSupport,
		reply: api.support.messages.sendMessage,
		savesWhileTyping: false
	}
])('$name page left and entered again', ({ surface, path, Page, reply, savesWhileTyping }) => {
	let replies: Array<PromiseWithResolvers<never>>;

	function storedDrafts(): Record<string, string> {
		return JSON.parse(localStorage.getItem(`drafts:${surface}`) ?? '{}');
	}

	async function enterPage(): Promise<void> {
		page.url = new URL(`https://example.com${path}?thread=thread-a`);
		page.data = {
			lang: 'en',
			viewer: { _id: 'user-1', name: 'Visitor' },
			capabilitiesResolved: true,
			capabilities: { billing: { usable: true }, ai: { usable: true } }
		};
		const contentProps = { data: page.data };
		component = mount(ChatTestProvider<typeof contentProps>, {
			target: document.body,
			props: {
				client,
				content: Page as unknown as Component<typeof contentProps>,
				contentProps
			}
		});
		await settleWork();
		await vi.waitFor(() => expect(textarea()).toBeDefined());
	}

	async function leavePage(): Promise<void> {
		if (component) await unmount(component);
		component = undefined;
		document.body.replaceChildren();
	}

	beforeEach(() => {
		replies = [];
		// The support widget opens the thread named in the URL once it exists.
		vi.spyOn(client, 'query').mockResolvedValue({});
		vi.spyOn(client, 'mutation').mockImplementation(((reference: FunctionReference<'mutation'>) => {
			if (getFunctionName(reference) !== getFunctionName(reply)) return new Promise(() => {});
			const answer = Promise.withResolvers<never>();
			replies.push(answer);
			return answer.promise;
		}) as typeof client.mutation);
	});

	it('restores a refusal from before leaving into the page entered again', async () => {
		await enterPage();
		await send('A');
		if (savesWhileTyping) expect(storedDrafts()).toEqual({ 'thread-a': 'A' });
		await leavePage();

		await enterPage();
		expect(textarea().value).toBe('');
		await type('newer');
		replies[0]!.reject(new Error('refused'));
		await settleWork();

		expect(textarea().value).toBe('A\n\nnewer');
		expect(storedDrafts()).toEqual({ 'thread-a': 'A\n\nnewer' });

		const final = savesWhileTyping ? 'A\n\nnewer, edited' : 'A\n\nnewer';
		await type(final);
		await leavePage();
		await enterPage();
		expect(textarea().value).toBe(final);
	});

	it('settles a send from before leaving together with one sent after', async () => {
		await enterPage();
		await send('A');
		await leavePage();

		await enterPage();
		await send('B');
		await type('newer');
		replies[1]!.reject(new Error('refused'));
		await settleWork();
		expect(textarea().value).toBe('newer');

		replies[0]!.reject(new Error('refused'));
		await settleWork();
		expect(textarea().value).toBe('A\n\nB\n\nnewer');
		expect(storedDrafts()).toEqual({ 'thread-a': 'A\n\nB\n\nnewer' });
	});

	it('sends nothing the ended session typed from the composer still on screen', async () => {
		await enterPage();
		await type('typed before the session ended');

		clearPersistedChatState();
		// Before the rebuild flushes, the old composer is the one a click reaches.
		sendButton().click();
		await settleWork();

		expect(replies).toHaveLength(0);
	});

	describe('after the session ended while the page stayed open', () => {
		async function sendInNewSessionAndReturn(): Promise<void> {
			await enterPage();
			clearPersistedChatState();
			await settleWork();
			await send('A');
			await leavePage();
			await enterPage();
		}

		it('restores a refusal from before leaving into the page entered again', async () => {
			await sendInNewSessionAndReturn();
			expect(textarea().value).toBe('');
			await type('newer');
			replies[0]!.reject(new Error('refused'));
			await settleWork();

			expect(textarea().value).toBe('A\n\nnewer');
			expect(storedDrafts()).toEqual({ 'thread-a': 'A\n\nnewer' });
		});

		it('settles a send from before leaving together with one sent after', async () => {
			await sendInNewSessionAndReturn();
			await send('B');
			await type('newer');
			replies[1]!.reject(new Error('refused'));
			await settleWork();
			expect(textarea().value).toBe('newer');

			replies[0]!.reject(new Error('refused'));
			await settleWork();
			expect(textarea().value).toBe('A\n\nB\n\nnewer');
			expect(storedDrafts()).toEqual({ 'thread-a': 'A\n\nB\n\nnewer' });
		});
	});

	if (surface === 'support') {
		describe('with a file attached to the refused send', () => {
			const reviewFile: Attachment = {
				type: 'file',
				key: 'review-file',
				name: 'review.txt',
				size: 3,
				mimeType: 'text/plain',
				url: 'https://chat.test/review.txt',
				uploadState: { status: 'success', progress: 100, fileId: 'review-file' }
			};
			const keys = (context: ChatUIContext) =>
				context.attachments.map((attachment) => ('key' in attachment ? attachment.key : ''));

			/** The composer's context, as the chat on screen last displayed it. */
			let contexts: () => ChatUIContext;

			beforeEach(() => {
				const displayed = vi.spyOn(ChatUIContext.prototype, 'setDisplayMessages');
				contexts = () => displayed.mock.contexts.at(-1) as ChatUIContext;
			});

			function lastReplyFileIds(): unknown {
				const replyName = getFunctionName(reply);
				const [, args] = vi
					.mocked(client.mutation)
					.mock.calls.filter(([reference]) => getFunctionName(reference) === replyName)
					.at(-1)!;
				return (args as { fileIds?: string[] }).fileIds;
			}

			async function sendWithFileAndLeave(): Promise<void> {
				await enterPage();
				contexts().addAttachments([reviewFile]);
				await send('A');
				expect(contexts().attachments).toEqual([]);
				await leavePage();
			}

			it.each(['before the page is entered again', 'while its thread is looked up', 'after'])(
				'brings the file of a send refused %s back into the composer',
				async (timing) => {
					await sendWithFileAndLeave();
					const lookup = Promise.withResolvers<Record<string, never>>();
					if (timing === 'before the page is entered again') {
						replies[0]!.reject(new Error('refused'));
						await settleWork();
					}
					if (timing === 'while its thread is looked up') {
						vi.mocked(client.query).mockReturnValueOnce(lookup.promise);
					}
					await enterPage();
					if (timing !== 'before the page is entered again') {
						replies[0]!.reject(new Error('refused'));
						await settleWork();
					}
					lookup.resolve({});
					await settleWork();

					expect(keys(contexts())).toEqual(['review-file']);
					await send('B');
					expect(lastReplyFileIds()).toEqual(['review-file']);
				}
			);

			it('carries the file into neither another thread nor a new conversation', async () => {
				const selected = vi.spyOn(SupportContext.prototype, 'selectThreadFromUrl');
				await sendWithFileAndLeave();
				await enterPage();
				replies[0]!.reject(new Error('refused'));
				await settleWork();
				const support = selected.mock.contexts.at(-1) as SupportContext;
				const context = contexts();
				expect(keys(context)).toEqual(['review-file']);

				support.selectThread('thread-b');
				await settleWork();
				expect(keys(context)).toEqual([]);
				await send('B');
				expect(lastReplyFileIds() ?? []).toEqual([]);

				context.addAttachments([reviewFile]);
				support.startNewThread();
				await settleWork();
				expect(keys(context)).toEqual([]);
			});
		});
	}
});
