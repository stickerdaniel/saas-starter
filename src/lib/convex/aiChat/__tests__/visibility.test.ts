import { describe, expect, it } from 'vitest';
import { isVisibleAiChatThread } from '../visibility';

describe('isVisibleAiChatThread', () => {
	it('hides a warm thread even when it has a timestamp', () => {
		expect(isVisibleAiChatThread({ isWarm: true, lastMessageAt: 123 })).toBe(false);
	});

	it('hides a never-used thread (no timestamp, no preview)', () => {
		expect(isVisibleAiChatThread({})).toBe(false);
	});

	it('shows a thread that has only lastMessageAt (file-only send, no preview text)', () => {
		expect(isVisibleAiChatThread({ lastMessageAt: 1717000000000 })).toBe(true);
	});

	it('treats lastMessageAt 0 as a real "has been used" signal', () => {
		expect(isVisibleAiChatThread({ lastMessageAt: 0 })).toBe(true);
	});

	it('shows a legacy thread that has a preview but no timestamp', () => {
		expect(isVisibleAiChatThread({ lastMessage: 'hi' })).toBe(true);
	});

	it('shows a normal thread with both signals', () => {
		expect(isVisibleAiChatThread({ lastMessage: 'hi', lastMessageAt: 1717000000000 })).toBe(true);
	});

	it('does not count an empty-string preview on its own', () => {
		expect(isVisibleAiChatThread({ lastMessage: '' })).toBe(false);
	});
});
