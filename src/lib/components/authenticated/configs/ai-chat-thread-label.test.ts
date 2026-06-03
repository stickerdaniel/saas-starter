import { describe, expect, it } from 'vitest';
import { aiChatThreadLabel } from './ai-chat-thread-label';

describe('aiChatThreadLabel', () => {
	it('prefers the title (trimmed) over the preview', () => {
		expect(
			aiChatThreadLabel(
				{ title: '  Postgres Indexing  ', lastMessage: 'raw text' },
				'New conversation'
			)
		).toBe('Postgres Indexing');
	});

	it('falls back to a short last-message preview unchanged', () => {
		expect(aiChatThreadLabel({ lastMessage: 'Short message' }, 'New conversation')).toBe(
			'Short message'
		);
	});

	it('truncates a long preview to 30 chars + ellipsis', () => {
		const long = 'a'.repeat(40);
		expect(aiChatThreadLabel({ lastMessage: long }, 'New conversation')).toBe(
			'a'.repeat(30) + '...'
		);
	});

	it('uses the localized empty label when there is no title or preview', () => {
		expect(aiChatThreadLabel({}, 'Neue Unterhaltung')).toBe('Neue Unterhaltung');
	});

	it('treats a whitespace-only title as no title', () => {
		expect(
			aiChatThreadLabel({ title: '   ', lastMessage: 'real preview' }, 'New conversation')
		).toBe('real preview');
	});

	it('treats an empty preview as no preview (file-only thread)', () => {
		expect(aiChatThreadLabel({ lastMessage: '' }, 'New conversation')).toBe('New conversation');
	});

	it('falls back to the hardcoded default when no label is provided', () => {
		expect(aiChatThreadLabel({})).toBe('New conversation');
	});
});
