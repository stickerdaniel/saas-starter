import { describe, expect, it } from 'vitest';
import { toToolPhase, toToolRenderPart } from './tool-part-adapter';

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
	// The AI Elements Tool table: input without output runs only while the message does.
	it.each([
		['input-streaming', true, 'running'],
		['input-available', true, 'running'],
		['input-streaming', false, 'failed'],
		['input-available', false, 'failed'],
		['output-available', true, 'ran'],
		['output-available', false, 'ran'],
		['output-error', true, 'failed'],
		['output-error', false, 'failed']
	] as const)(
		'reads %s while the message is in progress (%s) as %s',
		(state, inProgress, phase) => {
			expect(toToolPhase(state, inProgress)).toBe(phase);
		}
	);
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
