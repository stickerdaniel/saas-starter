import { describe, it, expect } from 'vitest';
import { SUPPORT_AGENT_INSTRUCTIONS } from '../agent';

/**
 * Pins the escalation policy in the support agent's system prompt. The prompt is
 * plain prose the model reads at runtime, so a hand-edit that drops a bullet
 * silently changes support behavior with nothing else failing. These assertions
 * fail loudly if the handoff guidance is removed.
 */
describe('SUPPORT_AGENT_INSTRUCTIONS', () => {
	// A bug report must reach a human, not stop at an explanation.
	it('escalates bug reports to a human via request_handoff', () => {
		expect(SUPPORT_AGENT_INSTRUCTIONS).toContain('request_handoff');
		expect(SUPPORT_AGENT_INSTRUCTIONS).toContain('call request_handoff so a human sees it');
		expect(SUPPORT_AGENT_INSTRUCTIONS).toContain('An explanation does not fix a bug');
	});

	// The handoff trigger covers more than bugs: anything the agent cannot resolve
	// or that its instructions do not cover.
	it('widens the handoff trigger beyond bug reports', () => {
		expect(SUPPORT_AGENT_INSTRUCTIONS).toContain('a bug or error report');
		expect(SUPPORT_AGENT_INSTRUCTIONS).toContain('anything you cannot resolve yourself');
	});

	// Handoff UX: point the user to the widget's email field, never ask them to
	// type an email into the chat.
	it('directs handed-off users to the email field, not the chat', () => {
		expect(SUPPORT_AGENT_INSTRUCTIONS).toContain('email field below the conversation');
	});
});
