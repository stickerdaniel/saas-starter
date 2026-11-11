import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { ConvexClient } from 'convex/browser';
import { getFunctionName } from 'convex/server';
import ChatTestProvider from '#lib/chat/ui/test-fixtures/ChatTestProvider.svelte';
import AIChatbar from './ai-chatbar.svelte';
import { SupportContext } from './support-context.svelte.ts';
import en from '../../../i18n/en.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn() } }));

let component: ReturnType<typeof mount> | undefined;
let client: ConvexClient;

beforeEach(() => {
	client = new ConvexClient('https://chatbar-test.convex.cloud', { disabled: true });
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	await client.close();
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

async function mountChatbar(support: SupportContext): Promise<HTMLTextAreaElement> {
	const contentProps = { isFeedbackOpen: false };
	component = mount(ChatTestProvider<typeof contentProps>, {
		target: document.body,
		props: { client, content: AIChatbar, contentProps, supportThread: support }
	});
	await tick();
	return document.querySelector('textarea')!;
}

function type(input: HTMLTextAreaElement, value: string): void {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
}

type WarmThread = { threadId: string; notificationEmail: null };

/** Submits a prompt whose warm thread stays pending until the test settles it. */
async function submitDuringWarmAcquisition(prompt: string) {
	const warmThread = Promise.withResolvers<WarmThread>();
	const sentMessage = Promise.withResolvers<null>();
	const mutation = vi
		.spyOn(client, 'mutation')
		.mockImplementation((reference) =>
			getFunctionName(reference) === 'support/threads:getOrCreateWarmThread'
				? warmThread.promise
				: sentMessage.promise
		);
	vi.spyOn(client, 'onUpdate').mockReturnValue(
		Object.assign(() => {}, { unsubscribe() {}, getCurrentValue: () => undefined })
	);
	vi.spyOn(console, 'error').mockImplementation(() => {});
	const support = new SupportContext();
	const input = await mountChatbar(support);

	type(input, prompt);
	await tick();
	document.querySelector<HTMLButtonElement>(`button[aria-label="${en.chat.aria.send}"]`)!.click();
	await tick();
	expect(input.value).toBe('');

	const settle = async (outcome: 'resolve' | 'reject') => {
		if (outcome === 'resolve') {
			warmThread.resolve({ threadId: 'thread-a', notificationEmail: null });
		} else {
			warmThread.reject(new Error('warm acquisition failed'));
		}
		await tick();
		await tick();
		await tick();
	};
	const mutationNames = () => mutation.mock.calls.map(([reference]) => getFunctionName(reference));
	return { support, input, settle, sentMessage, mutationNames };
}

describe('AI chatbar submit', () => {
	it.each(['resolve', 'reject'] as const)(
		'keeps a thread selected during warm acquisition and its prompt when acquisition settles (%s)',
		async (outcome) => {
			const { support, input, settle, mutationNames } = await submitDuringWarmAcquisition(
				'question for a new thread'
			);
			flushSync(() => support.selectThread('thread-b'));

			await settle(outcome);

			expect(support.conversation.threadId).toBe('thread-b');
			expect(support.navigation.currentView).toBe('chat');
			expect(input.value).toBe('question for a new thread');
			expect(mutationNames()).toEqual(['support/threads:getOrCreateWarmThread']);
		}
	);

	it.each(['resolve', 'reject'] as const)(
		'keeps input typed after a retired submit (%s)',
		async (outcome) => {
			const { support, input, settle } = await submitDuringWarmAcquisition('first question');
			flushSync(() => support.selectThread('thread-b'));
			type(input, 'second question');
			await tick();

			await settle(outcome);

			expect(input.value).toBe('second question');
		}
	);

	it('leaves a dispatched prompt out of the input after navigation', async () => {
		const { support, input, settle, sentMessage, mutationNames } =
			await submitDuringWarmAcquisition('question already sent');
		await settle('resolve');
		await vi.waitFor(() => expect(mutationNames()).toContain('support/messages:sendMessage'));
		flushSync(() => support.selectThread('thread-b'));

		sentMessage.reject(new Error('connection lost'));
		await tick();
		await tick();

		expect(support.conversation.threadId).toBe('thread-b');
		expect(input.value).toBe('');
	});

	it('sends to its warm thread when nothing navigated', async () => {
		const { support, input, settle, sentMessage, mutationNames } =
			await submitDuringWarmAcquisition('question for a new thread');

		await settle('resolve');
		sentMessage.resolve(null);
		await vi.waitFor(() =>
			expect(mutationNames()).toEqual([
				'support/threads:getOrCreateWarmThread',
				'support/messages:sendMessage'
			])
		);

		expect(support.conversation.threadId).toBe('thread-a');
		expect(input.value).toBe('');
	});
});
