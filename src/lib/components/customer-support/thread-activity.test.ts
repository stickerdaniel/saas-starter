import { describe, expect, it } from 'vitest';
import { hasConversationActivity } from './thread-activity';

describe('hasConversationActivity', () => {
	it('keeps a conversation whose only reply is an attachment', () => {
		// An attachment-only admin reply is valid (sendAdminReply accepts an empty
		// prompt alongside fileIds) and leaves the denormalized preview text empty.
		expect(hasConversationActivity({ lastMessageAt: 1_700_000_000_000 })).toBe(true);
	});

	it('keeps a conversation stored before the timestamp was denormalized', () => {
		// Those rows carry only the preview text until the backfill mutation is
		// run by hand, which upgrading an installation does not do on its own.
		expect(hasConversationActivity({ lastMessage: 'Older stored preview' })).toBe(true);
	});

	it('hides a conversation that never carried a message', () => {
		expect(hasConversationActivity({})).toBe(false);
	});
});
