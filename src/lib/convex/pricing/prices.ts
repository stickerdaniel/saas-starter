export type ModelPrice = { in: number; out: number; reasoning?: number; cachedIn?: number };
// $ per 1M tokens. Seed = the app's chat model. Keep in sync with
// utils/chatModel.ts (CHAT_MODEL_ID).
export const PRICES: Record<string, ModelPrice> = {
	// CHAT_MODEL_ID placeholder zero-rate — fill in the real $/Mtok; native
	// OpenRouter cost is used when present, this is the fallback.
	'google/gemma-4-26b-a4b-it': { in: 0.0, out: 0.0 }
};
const PER_TOKEN = 1 / 1_000_000;
export type Tokens = { input: number; output: number; reasoning?: number; cachedInput?: number };
/** USD from tokens x price map. null => model unpriced (recorder marks costSource 'unknown'). */
export function costOf(
	model: string,
	t: Tokens,
	table: Record<string, ModelPrice> = PRICES
): number | null {
	const p = table[model]; // noUncheckedIndexedAccess: ModelPrice | undefined
	if (!p) return null;
	const cachedIn = t.cachedInput ?? 0;
	const freshIn = Math.max(0, t.input - cachedIn);
	const usd =
		freshIn * p.in +
		cachedIn * (p.cachedIn ?? p.in) +
		t.output * p.out +
		(t.reasoning ?? 0) * (p.reasoning ?? p.out);
	return usd * PER_TOKEN;
}
