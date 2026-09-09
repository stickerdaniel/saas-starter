import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const aiChat = readFileSync(resolve('src/routes/[[lang]]/app/ai-chat/thread-chat.svelte'), 'utf8');
const adminSupport = readFileSync(
	resolve('src/routes/[[lang]]/admin/support/thread-chat.svelte'),
	'utf8'
);
const simpleChat = readFileSync(resolve('src/lib/chat/examples/SimpleChat.svelte'), 'utf8');
const chatInput = readFileSync(resolve('src/lib/chat/ui/ChatInput.svelte'), 'utf8');

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
});

describe('SimpleChat example contract', () => {
	it('binds one explicit send owner and disables unsupported uploads', () => {
		expect(simpleChat).toContain('threadId: string;');
		expect(simpleChat).toContain("sendMessage: ChatCoreAPI['sendMessage'];");
		expect(simpleChat).toContain('externalCore={chatCore}');
		expect(simpleChat).toContain('showFileButton={false}');
		expect(simpleChat.match(/chatCore\.sendMessage\(client, prompt\)/g)).toHaveLength(1);
		expect(simpleChat).not.toContain('showFileButton={true}');
	});

	it('does not process pasted files when uploads are disabled', () => {
		expect(simpleChat).toContain('showFileButton={false}');
		expect(chatInput).toMatch(
			/function handlePaste\(event: ClipboardEvent\) \{\s*if \(!showFileButton\) return;\s*const items/
		);
	});
});
