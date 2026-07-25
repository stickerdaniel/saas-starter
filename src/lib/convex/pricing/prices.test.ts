import { describe, it, expect } from 'vitest';
import { PRICES, costOf } from './prices';
import { AI_CHAT_MODEL_ID, SUPPORT_MODEL_ID, TITLE_MODEL_ID } from '../utils/chatModel';

// One million input + one million output tokens, so the expected USD for a
// model is exactly (in + out) dollars (1M tokens at $X/Mtok = $X).
const SAMPLE = { input: 1_000_000, output: 1_000_000 };

describe('costOf', () => {
	it('prices the seeded chat model at its $/Mtok rate', () => {
		// gemma is a zero-rate seed: 1M + 1M tokens still cost nothing.
		expect(costOf('google/gemma-4-26b-a4b-it', SAMPLE)).toBe(0);
	});

	it('splits fresh vs cached input and falls reasoning back to the output rate', () => {
		// Reasoning (200) and cached input (400) are subsets of output (500) and
		// input (1000). Model 'm' has no cachedIn/reasoning rate, so both subsets
		// bill at their parent rate. With in=1, out=2 ($/Mtok):
		// fresh 600*1 + cached 400*1 + text 300*2 + reasoning 200*2 = 2000 micro-$
		const usd = costOf(
			'm',
			{ input: 1000, output: 500, reasoning: 200, cachedInput: 400 },
			{ m: { in: 1, out: 2 } }
		);
		expect(usd).toBeCloseTo(0.002, 12);
	});

	it('does not double-bill reasoning tokens without a separate reasoning rate', () => {
		// outputTokens already includes reasoning tokens (AI SDK usage semantics),
		// so reporting reasoning must not change the cost when it bills at the
		// output rate anyway.
		const table = { m: { in: 1, out: 2 } };
		const withReasoning = costOf('m', { input: 0, output: 500, reasoning: 200 }, table);
		const withoutReasoning = costOf('m', { input: 0, output: 500 }, table);
		expect(withReasoning).toBe(withoutReasoning);
	});

	it('bills only the reasoning subset at a separate reasoning rate', () => {
		// text 300*2 + reasoning 200*4 = 1400 micro-$
		const usd = costOf(
			'm',
			{ input: 0, output: 500, reasoning: 200 },
			{ m: { in: 1, out: 2, reasoning: 4 } }
		);
		expect(usd).toBeCloseTo(0.0014, 12);
	});

	it('returns null for an unpriced model', () => {
		expect(costOf('unknown/model-x', SAMPLE)).toBeNull();
	});

	// Regression guard against PRICES/chatModel divergence: every model the app
	// actually runs must have a price row, or computed-cost fallback breaks.
	// Each workload is listed separately so raising one of them alone still
	// trips this when its new model has no row.
	it.each([
		['AI_CHAT_MODEL_ID', AI_CHAT_MODEL_ID],
		['SUPPORT_MODEL_ID', SUPPORT_MODEL_ID],
		['TITLE_MODEL_ID', TITLE_MODEL_ID]
	])('keeps a price row for %s', (_label, modelId) => {
		expect(PRICES[modelId]).toBeDefined();
		expect(costOf(modelId, SAMPLE)).not.toBeNull();
	});
});
