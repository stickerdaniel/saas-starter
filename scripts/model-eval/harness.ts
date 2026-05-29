import { stepCountIs, streamText, type ModelMessage, type TextStreamPart, type ToolSet } from 'ai';
import { openrouter } from '@openrouter/ai-sdk-provider';
import { getGeocoding, getWeather } from '../../src/lib/convex/aiChat/tools/weather.ts';
import { materializeFromStreamParts } from './materialize.ts';
import type { MaterializedAssistant } from './types.ts';

// The app sets no output cap (aiChat/agent.ts), so a reasoning model can spend
// freely. Give enough room to reason AND answer; a low cap false-fails the text
// check when reasoning eats the whole budget before any answer is emitted.
const MAX_OUTPUT_TOKENS = 8000;
const MAX_STEPS = 5;

// Mirrors the aiChat agent contract: an assistant that reasons, calls tools for
// live data, and analyzes attached images/documents.
const SYSTEM =
	'You are a helpful AI assistant. Think before answering, use the provided tools when a ' +
	'question needs live data, and analyze any images or documents the user shares.';

export type Probe = {
	messages: ModelMessage[];
	withTools: boolean;
};

export type ProbeResult = {
	materialized: MaterializedAssistant;
	ms: number;
};

async function runInner(model: string, probe: Probe, signal: AbortSignal): Promise<ProbeResult> {
	const t0 = performance.now();
	const parts: Array<TextStreamPart<ToolSet>> = [];

	const result = streamText({
		// Same provider + reasoning config as aiChat/agent.ts (reasoning via extraBody).
		model: openrouter(model, { extraBody: { reasoning: { enabled: true } } }),
		system: SYSTEM,
		messages: probe.messages,
		// Greedy decoding: a capability check asks "can the model do this", so we
		// want its best-shot, reproducible behaviour, not the app's creative 0.7
		// sampling (which makes tool calling flaky run-to-run).
		temperature: 0,
		maxOutputTokens: MAX_OUTPUT_TOKENS,
		tools: probe.withTools ? { getGeocoding, getWeather } : undefined,
		// AI SDK v6: multi-step is driven by stopWhen, not maxSteps.
		stopWhen: stepCountIs(probe.withTools ? MAX_STEPS : 1),
		// Lets the timeout actually cancel the request instead of leaking a stream.
		abortSignal: signal
	});

	for await (const part of result.fullStream) {
		parts.push(part);
	}
	// Settle terminal promises so the stream is fully closed before materializing.
	await result.response;

	return { materialized: materializeFromStreamParts(parts), ms: performance.now() - t0 };
}

export async function runProbe(
	model: string,
	probe: Probe,
	timeoutMs: number
): Promise<ProbeResult> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await runInner(model, probe, controller.signal);
	} catch (err) {
		// Aborting surfaces as a stream error; report it as the timeout it is.
		if (controller.signal.aborted)
			throw new Error(`timed out after ${timeoutMs}ms`, { cause: err });
		throw err;
	} finally {
		clearTimeout(timer);
	}
}
