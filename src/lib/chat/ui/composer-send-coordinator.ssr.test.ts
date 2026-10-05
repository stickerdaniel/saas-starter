// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { clearPersistedChatState } from '../core/chat-persisted-state.ts';
import {
	ComposerSendCoordinator,
	acquireComposerSendCoordinator
} from './composer-send-coordinator.ts';

describe('surface owners in a server render', () => {
	it('gives every render its own owner and keeps none of them', () => {
		const create = () => new ComposerSendCoordinator();
		const first = acquireComposerSendCoordinator('ai-chat', create);
		const second = acquireComposerSendCoordinator('ai-chat', create);
		const forget = vi.spyOn(first.owner, 'forgetPersistedState');

		expect(second.owner).not.toBe(first.owner);
		clearPersistedChatState();
		expect(forget).not.toHaveBeenCalled();
		first.release();
		second.release();
	});
});
