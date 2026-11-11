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

describe('AI chatbar submit', () => {
	it('leaves a thread selected during warm acquisition in place', async () => {
		const warmThread = Promise.withResolvers<{ threadId: string; notificationEmail: null }>();
		const mutation = vi
			.spyOn(client, 'mutation')
			.mockImplementation((reference) =>
				getFunctionName(reference) === 'support/threads:getOrCreateWarmThread'
					? warmThread.promise
					: Promise.resolve({})
			);
		vi.spyOn(client, 'onUpdate').mockReturnValue(
			Object.assign(() => {}, { unsubscribe() {}, getCurrentValue: () => undefined })
		);
		const support = new SupportContext();
		const input = await mountChatbar(support);

		input.value = 'question for a new thread';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();
		document.querySelector<HTMLButtonElement>(`button[aria-label="${en.chat.aria.send}"]`)!.click();
		await tick();
		flushSync(() => support.selectThread('thread-b'));

		warmThread.resolve({ threadId: 'thread-a', notificationEmail: null });
		await vi.waitFor(() => expect(mutation).toHaveBeenCalledOnce());
		await tick();
		await tick();

		expect(support.conversation.threadId).toBe('thread-b');
		expect(support.navigation.currentView).toBe('chat');
		expect(mutation.mock.calls.map(([reference]) => getFunctionName(reference))).toEqual([
			'support/threads:getOrCreateWarmThread'
		]);
	});
});
