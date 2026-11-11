import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount, type ComponentProps } from 'svelte';
import type * as Svelte from 'svelte';
import { ConvexClient } from 'convex/browser';
import { computeAccessibleName } from 'dom-accessibility-api';
import { api } from '#lib/convex/_generated/api.js';
import { ChatCore } from '../core/chat-core.svelte.ts';
import type { DisplayMessage } from '../core/types.js';
import { ChatUIContext } from './chat-context.svelte.ts';
import ChatTestProvider from './test-fixtures/ChatTestProvider.svelte';
import ChatMessagesHarness from './test-fixtures/ChatMessagesHarness.svelte';
import { AI_CHAT_GENERATION_FAILED_NOTICE, AI_CHAT_LIMIT_NOTICE } from '#lib/convex/constants.js';
import en from '../../../i18n/en.json';

// Vitest resolves Svelte's server entry by default; use its real client runtime for mounting.
vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
// Attachments pull in the KaTeX stylesheet, which Node cannot import; these messages have none.
vi.mock('./ChatAttachments.svelte', () => ({ default: () => {} }));

type HarnessProps = ComponentProps<typeof ChatMessagesHarness>;

let component: ReturnType<typeof mount> | undefined;
let client: ConvexClient;
let ctx: ChatUIContext;

function displayMessage(
	id: string,
	role: DisplayMessage['role'],
	text: string,
	metadata?: Record<string, unknown>
): DisplayMessage {
	return {
		id,
		_creationTime: 0,
		order: 0,
		role,
		status: 'success',
		text,
		parts: [{ type: 'text', text, state: 'done' }],
		metadata,
		displayText: text,
		displayReasoning: '',
		isStreaming: false,
		hasReasoningStream: false
	};
}

const thread = [
	displayMessage('user-1', 'user', 'My invoice is wrong'),
	displayMessage('user-2', 'user', 'It charges me twice'),
	displayMessage('assistant-1', 'assistant', 'Let me hand this to the team.'),
	displayMessage('admin-1', 'assistant', 'Refunded the duplicate charge.', { provider: 'human' })
];

beforeEach(() => {
	localStorage.clear();
	// jsdom has no matchMedia; the markdown renderer reads the color scheme.
	vi.stubGlobal(
		'matchMedia',
		vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
	);
	// jsdom has no ResizeObserver or element scrolling; the container follows the newest message.
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
	Object.defineProperty(Element.prototype, 'scrollTo', { value: () => {}, configurable: true });
	client = new ConvexClient('https://chat-test.convex.cloud', { disabled: true });
	ctx = new ChatUIContext(
		new ChatCore({
			threadId: 'thread-headings',
			api: { sendMessage: api.aiChat.messages.sendMessage }
		}),
		client,
		undefined,
		'right'
	);
	ctx.setDisplayMessages(thread);
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	ctx.dispose();
	await client.close();
	document.body.replaceChildren();
	localStorage.clear();
	Reflect.deleteProperty(Element.prototype, 'scrollTo');
	vi.unstubAllGlobals();
});

/** Every heading a screen reader's heading navigation visits, in document order. */
function headings() {
	return [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')].map(
		(heading) => ({
			name: computeAccessibleName(heading),
			level: Number(heading.getAttribute('aria-level') ?? heading.tagName.slice(1))
		})
	);
}

async function renderThread(
	perspective: HarnessProps['perspective'],
	authorHeadingLevel?: HarnessProps['authorHeadingLevel']
) {
	const contentProps: HarnessProps = { context: ctx, perspective, authorHeadingLevel };
	component = mount(ChatTestProvider<HarnessProps>, {
		target: document.body,
		props: { client, content: ChatMessagesHarness, contentProps }
	});
	await tick();
}

describe('message author headings', () => {
	it('names every message from the customer perspective by default', async () => {
		await renderThread(undefined);

		expect(headings()).toEqual([
			{ name: en.chat.author.you, level: 4 },
			{ name: en.chat.author.you, level: 4 },
			{ name: en.chat.author.assistant, level: 4 },
			{ name: en.chat.author.support_team, level: 4 }
		]);
	});

	it('names the user as the customer from the staff perspective', async () => {
		await renderThread('staff');

		expect(headings()).toEqual([
			{ name: en.chat.author.customer, level: 4 },
			{ name: en.chat.author.customer, level: 4 },
			{ name: en.chat.author.assistant, level: 4 },
			{ name: en.chat.author.support_team, level: 4 }
		]);
	});

	it('puts the author headings at the level the host asks for', async () => {
		await renderThread(undefined, 2);

		expect(headings().map(({ level }) => level)).toEqual([2, 2, 2, 2]);
	});
});

describe('AI chat system notices', () => {
	it.each([
		{ notice: AI_CHAT_LIMIT_NOTICE, copy: en.chat.notices.limit_reached },
		{ notice: AI_CHAT_GENERATION_FAILED_NOTICE, copy: en.chat.notices.generation_failed }
	])(
		'renders the $notice notice from its translation, not the stored text',
		async ({ notice, copy }) => {
			ctx.setDisplayMessages([
				displayMessage('user-1', 'user', 'Hello?'),
				displayMessage('notice-1', 'assistant', 'Stored fallback', {
					provider: 'system',
					providerMetadata: { system: { notice } }
				})
			]);

			await renderThread(undefined);

			expect(document.body.textContent).toContain(copy);
			expect(document.body.textContent).not.toContain('Stored fallback');
		}
	);
});

describe('scroll intent across threads', () => {
	it('opens the next thread at its bottom and follows it after the reader scrolled up in the last one', async () => {
		let resized: (entries: Array<{ target: Element }>) => void = () => {};
		vi.stubGlobal(
			'ResizeObserver',
			class {
				constructor(callback: typeof resized) {
					resized = callback;
				}
				observe() {}
				unobserve() {}
				disconnect() {}
			}
		);
		// The AI chat page keeps one list and one session while the selected thread changes.
		const core = new ChatCore({
			threadId: 'thread-a',
			api: { sendMessage: api.aiChat.messages.sendMessage }
		});
		ctx.dispose();
		ctx = new ChatUIContext(core, client, undefined, 'right');
		ctx.setDisplayMessages(thread);
		await renderThread(undefined);

		const log = document.querySelector<HTMLElement>('[role="log"]')!;
		const content = log.firstElementChild!;
		const scrollTo = vi.fn();
		Object.defineProperties(log, {
			scrollTo: { value: scrollTo },
			scrollTop: { value: 1600, writable: true },
			scrollHeight: { get: () => 2000 },
			clientHeight: { get: () => 400 }
		});
		const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
		const contentGrows = () => resized([{ target: content }]);
		const scrollUp = () => log.dispatchEvent(new WheelEvent('wheel', { deltaY: -120 }));

		scrollUp();
		scrollTo.mockClear();
		contentGrows();
		expect(scrollTo).not.toHaveBeenCalled();

		core.setThread('thread-b');
		ctx.setDisplayMessages([displayMessage('user-b', 'user', 'A question in B')]);
		await tick();
		await nextFrame();
		expect(scrollTo).toHaveBeenLastCalledWith({ top: 2000, behavior: 'instant' });

		contentGrows();
		expect(scrollTo).toHaveBeenLastCalledWith({ top: 2000, behavior: 'smooth' });

		scrollUp();
		scrollTo.mockClear();
		contentGrows();
		expect(scrollTo).not.toHaveBeenCalled();
		expect(document.querySelector('[role="log"]')).toBe(log);
	});
});
