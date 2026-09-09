import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { ConvexClient } from 'convex/browser';
import type { ChatSessionPort } from '../core/chat-session-port.js';
import ChatTestProvider from './test-fixtures/ChatTestProvider.svelte';
import ChatSessionPortHarness from './test-fixtures/ChatSessionPortHarness.svelte';

const aiChat = readFileSync(resolve('src/routes/[[lang]]/app/ai-chat/thread-chat.svelte'), 'utf8');
const adminSupport = readFileSync(
	resolve('src/routes/[[lang]]/admin/support/thread-chat.svelte'),
	'utf8'
);
const simpleChat = readFileSync(resolve('src/lib/chat/examples/SimpleChat.svelte'), 'utf8');
const simpleChatThread = readFileSync(
	resolve('src/lib/chat/examples/SimpleChatThread.svelte'),
	'utf8'
);
const simpleChatSession = readFileSync(
	resolve('src/lib/chat/examples/simple-chat-session.svelte.ts'),
	'utf8'
);
const chatInput = readFileSync(resolve('src/lib/chat/ui/ChatInput.svelte'), 'utf8');

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

describe('ChatInput send ownership', () => {
	it.each([
		['AI chat', aiChat, "toast.error($t('chat.messages.send_failed'));"],
		['admin support', adminSupport, "toast.error($t('admin.support.chat.send_error'));"]
	])('%s lets ChatInput own clear and rollback', (_name, source, toast) => {
		expect(source).not.toContain('chatUIContext.clearAttachments()');
		expect(source).not.toContain('chatUIContext.setInputValue(prompt)');
		const toastIndex = source.indexOf(toast);
		expect(toastIndex).toBeGreaterThan(-1);
		expect(source.indexOf('throw error;', toastIndex)).toBeGreaterThan(toastIndex);
	});

	it('keeps delayed route success from clearing attachments added after submit', () => {
		expect(aiChat).not.toMatch(/await chatCore\.sendMessage[\s\S]*clearAttachments\(\)/);
		expect(adminSupport).not.toMatch(/await client\.mutation[\s\S]*clearAttachments\(\)/);
	});

	it('renders from the narrow session port without a concrete ChatCore', async () => {
		const session: ChatSessionPort = {
			threadId: null,
			isNewConversation: true,
			threadGeneration: 0,
			isSending: false,
			isAwaitingStream: false,
			setAwaitingStream: () => {},
			streamCache: {
				getCachedReasoning: () => undefined,
				updateReasoningCache: () => {},
				clearReasoningCache: () => {},
				updateStatusCache: () => {}
			}
		};
		const client = new ConvexClient('https://session-port-test.convex.cloud', {
			disabled: true
		});
		const contentProps = { session };
		const component = mount(ChatTestProvider<typeof contentProps>, {
			target: document.body,
			props: { client, content: ChatSessionPortHarness, contentProps }
		});
		await tick();

		expect(document.querySelector('[data-testid="session-port-child"]')).not.toBeNull();

		await unmount(component);
		await client.close();
	});
});

describe('SimpleChat example contract', () => {
	it('binds one explicit send owner and disables unsupported uploads', () => {
		expect(simpleChat).toContain('threadId: string;');
		expect(simpleChatThread).toContain('externalCore={session.core}');
		expect(simpleChatThread).toContain('showFileButton={false}');
		expect(simpleChatThread.match(/session\.send\(client, prompt, uiContext\)/g)).toHaveLength(1);
		expect(simpleChatSession.match(/this\.core\.sendMessage\(client, prompt\)/g)).toHaveLength(1);
		expect(simpleChatSession).not.toMatch(/async send[\s\S]*setAllContextInputs\(''\)/);
		expect(simpleChatThread).not.toContain('showFileButton={true}');
	});

	it('does not process pasted files when uploads are disabled', () => {
		expect(simpleChatThread).toContain('showFileButton={false}');
		expect(chatInput).toMatch(
			/function handlePaste\(event: ClipboardEvent\) \{\s*if \(!showFileButton\) return;\s*const items/
		);
	});
});
