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
		},
		getAutoOpenedKeys: () => autoOpened.values()
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
						{ type: 'reasoning', text: 'Thinking', streamPartId: 'reason-1' }
					]
				})
			],
			controller
		);

		expect(openState.has('msg-1:reasoning-reason-1')).toBe(true);
		expect(autoOpened.has('msg-1:reasoning-reason-1')).toBe(true);
	});

	it('closes previously auto-opened reasoning parts once a later part appears', () => {
		const { controller, openState, autoOpened } = createController(
			['msg-1:reasoning-reason-1'],
			['msg-1:reasoning-reason-1']
		);

		syncReasoningAccordionState(
			[
				createDisplayMessage({
					status: 'success',
					parts: [
						{ type: 'reasoning', text: 'Done reasoning', streamPartId: 'reason-1' },
						{ type: 'text', text: 'Visible answer' }
					]
				})
			],
			controller
		);

		expect(openState.has('msg-1:reasoning-reason-1')).toBe(false);
		expect(autoOpened.has('msg-1:reasoning-reason-1')).toBe(false);
	});

	it('opens only the latest reasoning block across multiple reasoning and tool phases', () => {
		const { controller, openState } = createController();

		syncReasoningAccordionState(
			[
				createDisplayMessage({
					parts: [{ type: 'reasoning', text: 'First', streamPartId: 'reason-1' }]
				})
			],
			controller
		);
		expect(openState.has('msg-1:reasoning-reason-1')).toBe(true);

		syncReasoningAccordionState(
			[
				createDisplayMessage({
					status: 'success',
					parts: [
						{ type: 'reasoning', text: 'First', streamPartId: 'reason-1' },
						{ type: 'tool-getGeocoding', toolCallId: 'tool-1', state: 'output-available' }
					]
				})
			],
			controller
		);
		expect(openState.has('msg-1:reasoning-reason-1')).toBe(false);

		syncReasoningAccordionState(
			[
				createDisplayMessage({
					parts: [
						{ type: 'reasoning', text: 'First', streamPartId: 'reason-1' },
						{ type: 'tool-getGeocoding', toolCallId: 'tool-1', state: 'output-available' },
						{ type: 'reasoning', text: 'Second', streamPartId: 'reason-2' }
					]
				})
			],
			controller
		);
		expect(openState.has('msg-1:reasoning-reason-1')).toBe(false);
		expect(openState.has('msg-1:reasoning-reason-2')).toBe(true);

		syncReasoningAccordionState(
			[
				createDisplayMessage({
					status: 'success',
					parts: [
						{ type: 'reasoning', text: 'First', streamPartId: 'reason-1' },
						{ type: 'tool-getGeocoding', toolCallId: 'tool-1', state: 'output-available' },
						{ type: 'reasoning', text: 'Second', streamPartId: 'reason-2' },
						{ type: 'tool-getWeather', toolCallId: 'tool-2', state: 'output-available' }
					]
				})
			],
			controller
		);
		expect(openState.has('msg-1:reasoning-reason-2')).toBe(false);

		syncReasoningAccordionState(
			[
				createDisplayMessage({
					parts: [
						{ type: 'reasoning', text: 'First', streamPartId: 'reason-1' },
						{ type: 'tool-getGeocoding', toolCallId: 'tool-1', state: 'output-available' },
						{ type: 'reasoning', text: 'Second', streamPartId: 'reason-2' },
						{ type: 'tool-getWeather', toolCallId: 'tool-2', state: 'output-available' },
						{ type: 'reasoning', text: 'Third', streamPartId: 'reason-3' }
					]
				})
			],
			controller
		);
		expect(openState.has('msg-1:reasoning-reason-1')).toBe(false);
		expect(openState.has('msg-1:reasoning-reason-2')).toBe(false);
		expect(openState.has('msg-1:reasoning-reason-3')).toBe(true);
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

	it('removes stale auto-opened keys that are no longer present in the current message parts', () => {
		const { controller, openState, autoOpened } = createController(
			['msg-1:reasoning-ghost'],
			['msg-1:reasoning-ghost']
		);

		syncReasoningAccordionState(
			[
				createDisplayMessage({
					status: 'success',
					parts: [{ type: 'reasoning', text: 'Current', streamPartId: 'reason-1' }]
				})
			],
			controller
		);

		expect(openState.has('msg-1:reasoning-ghost')).toBe(false);
		expect(autoOpened.has('msg-1:reasoning-ghost')).toBe(false);
	});
});
