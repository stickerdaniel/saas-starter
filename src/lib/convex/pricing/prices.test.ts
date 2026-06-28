import { describe, it, expect } from 'vitest';
import { PRICES, costOf } from './prices';
import { CHAT_MODEL_ID } from '../utils/chatModel';

// One million input + one million output tokens, so the expected USD for a
// model is exactly (in + out) dollars (1M tokens at $X/Mtok = $X).
const SAMPLE = { input: 1_000_000, output: 1_000_000 };

describe('costOf', () => {
	it('prices the seeded chat model at its $/Mtok rate', () => {
		// gemma is a zero-rate seed: 1M + 1M tokens still cost nothing.
		expect(costOf('google/gemma-4-26b-a4b-it', SAMPLE)).toBe(0);
	});

	it('splits fresh vs cached input and falls reasoning back to the output rate', () => {
		// Model 'm' has no cachedIn/reasoning rate, so cached input bills at the input
		// rate and reasoning bills at the output rate. With in=1, out=2 ($/Mtok):
		// fresh 600*1 + cached 400*1 + out 500*2 + reasoning 200*2 = 2400 micro-$
		const usd = costOf(
			'm',
			{ input: 1000, output: 500, reasoning: 200, cachedInput: 400 },
			{ m: { in: 1, out: 2 } }
		);
		expect(usd).toBeCloseTo(0.0024, 12);
	});

	it('returns null for an unpriced model', () => {
		expect(costOf('unknown/model-x', SAMPLE)).toBeNull();
	});

	// Regression guard against PRICES/chatModel divergence: the chat model the app
	// actually runs must always have a price row, or computed-cost fallback breaks.
	it('keeps a price row for CHAT_MODEL_ID', () => {
		expect(PRICES[CHAT_MODEL_ID]).toBeDefined();
		expect(costOf(CHAT_MODEL_ID, SAMPLE)).not.toBeNull();
	});
});
