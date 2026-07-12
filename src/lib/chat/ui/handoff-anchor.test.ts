import { describe, it, expect } from 'vitest';
import { isHandoffAnchor } from './handoff-anchor';
import type { MessagePart } from '../core/types.js';

const CANNED = 'Thanks for reaching out.';

function msg(displayText: string, parts?: MessagePart[]) {
	return { displayText, parts };
}

describe('isHandoffAnchor', () => {
	it('detects the canned handoff response from the widget button flow', () => {
		expect(isHandoffAnchor(msg(`${CANNED} The team will reply here.`), CANNED)).toBe(true);
	});

	it('detects a request_handoff tool call from the agent flow', () => {
		const parts = [
			{ type: 'text', text: "I've noted that bug. The team is on it." },
			{ type: 'tool-request_handoff', state: 'output-available' }
		] as unknown as MessagePart[];
		expect(isHandoffAnchor(msg("I've noted that bug. The team is on it.", parts), CANNED)).toBe(
			true
		);
	});

	it('ignores ordinary assistant messages and unrelated tool calls', () => {
		expect(isHandoffAnchor(msg('The trial runs 14 days.'), CANNED)).toBe(false);
		const parts = [
			{ type: 'tool-someOtherTool', state: 'output-available' }
		] as unknown as MessagePart[];
		expect(isHandoffAnchor(msg('Done.', parts), CANNED)).toBe(false);
	});

	it('never matches everything when the canned text resolves empty', () => {
		expect(isHandoffAnchor(msg('Any message at all.'), '')).toBe(false);
	});
});
