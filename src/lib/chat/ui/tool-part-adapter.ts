import type { ToolPart } from '$lib/components/prompt-kit/tool/types.js';
import type { MessagePart } from '../core/types.js';

export function toToolRenderPart(part: MessagePart): ToolPart | undefined {
	if (!part.type.startsWith('tool-') || !('state' in part)) return undefined;
	const state = part.state;
	if (
		state !== 'input-streaming' &&
		state !== 'input-available' &&
		state !== 'output-available' &&
		state !== 'output-error'
	)
		return undefined;

	const rendered = {
		type: part.type,
		state,
		input: 'input' in part ? part.input : undefined,
		// Failed calls may carry an unfiltered provider error in either field.
		// Keep diagnostics out of the render model; ToolDetails localizes the state.
		output: state !== 'output-error' && 'output' in part ? part.output : undefined,
		toolCallId:
			'toolCallId' in part && typeof part.toolCallId === 'string' ? part.toolCallId : undefined
	};
	// Copied prompt-kit ToolPart declares Record payloads, but ToolDetails uses
	// Object.entries(input) and formatValue(unknown), including primitive output.
	// Preserve those SDK payloads here instead of rewriting copied UI internals
	// or asserting each unknown field throughout the first-party renderer.
	return rendered as ToolPart;
}
