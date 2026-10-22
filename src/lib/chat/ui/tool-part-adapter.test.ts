import { describe, expect, it } from 'vitest';
import { formatToolOutput, toToolPhase, toToolRenderPart } from './tool-part-adapter';

describe('tool UI boundary adapter', () => {
	it('names a static tool by its type and a dynamic tool by its SDK name', () => {
		expect(toToolRenderPart({ type: 'tool-getWeather', state: 'input-streaming' })?.name).toBe(
			'getWeather'
		);
		expect(
			toToolRenderPart({ type: 'dynamic-tool', toolName: 'runtime-tool', state: 'input-available' })
				?.name
		).toBe('runtime-tool');
	});
	// Input without output waits for its result row until the message itself fails.
	it.each([
		['input-streaming', 'streaming', 'running'],
		['input-available', 'pending', 'running'],
		['input-available', 'success', 'running'],
		['input-streaming', 'failed', 'failed'],
		['input-available', 'failed', 'failed'],
		['output-available', 'success', 'ran'],
		['output-available', 'failed', 'ran'],
		['output-error', 'streaming', 'failed'],
		['output-error', 'success', 'failed']
	] as const)('reads %s in a %s message as %s', (state, status, phase) => {
		expect(toToolPhase(state, status)).toBe(phase);
	});
	it.each(['input-streaming', 'input-available', 'output-available', 'output-error'] as const)(
		'accepts the supported %s state',
		(state) => {
			expect(toToolRenderPart({ type: 'tool-weather', state, toolCallId: 't' })).toMatchObject({
				state,
				toolCallId: 't'
			});
		}
	);
	it('accepts SDK 7 dynamic tool parts', () => {
		expect(
			toToolRenderPart({
				type: 'dynamic-tool',
				toolName: 'runtime-tool',
				state: 'output-available',
				toolCallId: 'dynamic-1',
				input: {},
				output: 'done'
			})
		).toMatchObject({ type: 'dynamic-tool', toolCallId: 'dynamic-1', output: 'done' });
	});
	it.each(['answer', 42, true, null, ['one'], { value: 'one' }].map((value) => [value]))(
		'preserves the SDK output %j',
		(output) => {
			expect(
				toToolRenderPart({ type: 'tool-weather', state: 'output-available', output })?.output
			).toBe(output);
		}
	);
	it('rejects unsupported states and narrows optional fields', () => {
		expect(toToolRenderPart({ type: 'text', text: 'x' })).toBeUndefined();
		expect(toToolRenderPart({ type: 'tool-weather', state: 'unknown' })).toBeUndefined();
		expect(
			toToolRenderPart({
				type: 'tool-weather',
				state: 'output-error',
				errorText: 42,
				toolCallId: {}
			})
		).toMatchObject({ toolCallId: undefined });
	});
	it('keeps text output as text and prints other values as indented JSON', () => {
		expect(formatToolOutput('Sunny\n21 °C')).toEqual({
			code: 'Sunny\n21 °C',
			language: 'text',
			truncated: false
		});
		expect(formatToolOutput({ forecast: 'Sunny' })).toEqual({
			code: '{\n  "forecast": "Sunny"\n}',
			language: 'json',
			truncated: false
		});
		expect(formatToolOutput(0)).toMatchObject({ code: '0', truncated: false });
	});
	it.each([
		['many short lines', Array.from({ length: 5_000 }, (_, day) => ({ day }))],
		['one long line', 'x'.repeat(100_000)]
	])('caps an oversized output with %s to a prefix of it', (_, output) => {
		const full = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
		const { code, truncated } = formatToolOutput(output);
		expect(truncated).toBe(true);
		expect(full.startsWith(code)).toBe(true);
		expect(code.length).toBeLessThanOrEqual(20_000);
		expect(code.split('\n').length).toBeLessThanOrEqual(400);
	});
	it('drops raw error text and failed output without mutating the source message', () => {
		const rawError = 'Provider failure: private diagnostic';
		const part = {
			type: 'tool-weather',
			state: 'output-error',
			errorText: rawError,
			output: { error: rawError },
			toolCallId: 'call-1'
		};
		const rendered = toToolRenderPart(part);
		expect(rendered).not.toHaveProperty('errorText');
		expect(rendered?.output).toBeUndefined();
		expect(rendered?.state).toBe('output-error');
		expect(rendered?.toolCallId).toBe('call-1');
		expect(JSON.stringify(rendered)).not.toContain(rawError);
		expect(part.errorText).toBe(rawError);
		expect(part.output).toEqual({ error: rawError });
	});
});
