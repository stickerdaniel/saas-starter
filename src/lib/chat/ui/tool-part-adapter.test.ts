import { describe, expect, it } from 'vitest';
import { toToolRenderPart } from './tool-part-adapter';

describe('copied tool UI boundary adapter', () => {
	it.each(['input-streaming', 'input-available', 'output-available', 'output-error'])(
		'accepts the supported %s state',
		(state) => {
			expect(toToolRenderPart({ type: 'tool-weather', state, toolCallId: 't' })).toMatchObject({
				state,
				toolCallId: 't'
			});
		}
	);
	it.each(['answer', 42, true, null, ['one'], { value: 'one' }].map((value) => [value]))(
		'preserves the SDK output %j despite the copied Record-only annotation',
		(output) => {
			expect(
				toToolRenderPart({ type: 'tool-weather', state: 'output-available', output })?.output
			).toBe(output);
		}
	);
	it('rejects unsupported states and narrows optional string fields', () => {
		expect(toToolRenderPart({ type: 'text', text: 'x' })).toBeUndefined();
		expect(toToolRenderPart({ type: 'tool-weather', state: 'unknown' })).toBeUndefined();
		expect(
			toToolRenderPart({
				type: 'tool-weather',
				state: 'output-error',
				errorText: 42,
				toolCallId: {}
			})
		).toMatchObject({ errorText: undefined, toolCallId: undefined });
	});
});
