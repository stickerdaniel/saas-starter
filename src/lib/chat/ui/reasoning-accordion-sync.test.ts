import { describe, expect, it } from 'vitest';
import type { DisplayMessage } from '../core/types.js';
import {
	syncReasoningAccordionState,
	type ReasoningAccordionController
} from './reasoning-accordion-sync.js';

function createController(initiallyOpen: string[] = [], initiallyAutoOpened: string[] = []) {
	const openState = new Set(initiallyOpen);
	const autoOpened = new Set(initiallyAutoOpened);

	const controller: ReasoningAccordionController = {
		isReasoningOpen: (messageId) => openState.has(messageId),
		setReasoningOpen: (messageId, isOpen) => {
			if (isOpen) {
				openState.add(messageId);
			} else {
				openState.delete(messageId);
			}
		},
		wasAutoOpened: (messageId) => autoOpened.has(messageId),
		markAutoOpened: (messageId) => {
			autoOpened.add(messageId);
		},
		clearAutoOpened: (messageId) => {
			autoOpened.delete(messageId);
		}
	};

	return { controller, openState, autoOpened };
}

function createDisplayMessage(overrides: Partial<DisplayMessage> = {}): DisplayMessage {
	return {
		id: 'msg-1',
		_creationTime: 1,
		role: 'assistant',
		status: 'streaming',
		order: 1,
		text: '',
		displayText: '',
		displayReasoning: '',
		isStreaming: true,
		hasReasoningStream: true,
		parts: [],
		...overrides
	};
}

describe('syncReasoningAccordionState', () => {
	it('opens the active trailing reasoning part for in-progress messages', () => {
		const { controller, openState, autoOpened } = createController();

		syncReasoningAccordionState(
			[
				createDisplayMessage({
					parts: [
						{ type: 'tool-getWeather', toolCallId: 'tool-1', state: 'output-available' },
						{ type: 'reasoning', text: 'Thinking' }
					]
				})
			],
			controller
		);

		expect(openState.has('msg-1:reasoning-1')).toBe(true);
		expect(autoOpened.has('msg-1:reasoning-1')).toBe(true);
	});

	it('closes previously auto-opened reasoning parts once a later part appears', () => {
		const { controller, openState, autoOpened } = createController(
			['msg-1:reasoning-0'],
			['msg-1:reasoning-0']
		);

		syncReasoningAccordionState(
			[
				createDisplayMessage({
					status: 'success',
					parts: [
						{ type: 'reasoning', text: 'Done reasoning' },
						{ type: 'text', text: 'Visible answer' }
					]
				})
			],
			controller
		);

		expect(openState.has('msg-1:reasoning-0')).toBe(false);
		expect(autoOpened.has('msg-1:reasoning-0')).toBe(false);
	});

	it('keeps the message-level fallback behavior for messages without parts', () => {
		const { controller, openState } = createController();

		syncReasoningAccordionState(
			[
				createDisplayMessage({
					id: 'msg-legacy',
					parts: undefined,
					displayReasoning: 'Legacy reasoning',
					displayText: ''
				})
			],
			controller
		);

		expect(openState.has('msg-legacy')).toBe(true);
	});
});
