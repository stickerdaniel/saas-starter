import type { ToolPart } from '$lib/components/prompt-kit/tool/types.js';
import type { MessagePart } from '../core/types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toToolRenderPart(part: MessagePart): ToolPart | undefined {
	if ((part.type !== 'dynamic-tool' && !part.type.startsWith('tool-')) || !('state' in part)) {
		return undefined;
	}
	const state = part.state;
	if (
		state !== 'input-streaming' &&
		state !== 'input-available' &&
		state !== 'output-available' &&
		state !== 'output-error'
	) {
		return undefined;
	}

	return {
		type: part.type,
		state,
		input: 'input' in part && isRecord(part.input) ? part.input : undefined,
		// Failed calls may carry an unfiltered provider error in either field.
		// Keep diagnostics out of the render model; ToolDetails localizes the state.
		output: state !== 'output-error' && 'output' in part ? part.output : undefined,
		toolCallId:
			'toolCallId' in part && typeof part.toolCallId === 'string' ? part.toolCallId : undefined
	};
}
