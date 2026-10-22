import type { MessagePart, ToolPartState } from '../core/types.js';

/**
 * The render model of one tool call. Built only by {@link toToolRenderPart}, which keeps
 * provider error text out of it.
 */
export type ToolPart = {
	type: string;
	/** Tool name for the title: `getWeather` for `tool-getWeather`, `toolName` for dynamic tools. */
	name: string;
	state: ToolPartState;
	input?: Record<string, unknown>;
	output?: unknown;
	toolCallId?: string;
};

/**
 * How a tool call reads in the transcript, after the AI Elements Tool pattern: it runs
 * while its input streams or waits for output, and an input that never got output before
 * the message settled failed like an `output-error` did.
 */
export type ToolPhase = 'running' | 'ran' | 'failed';

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
		name:
			part.type === 'dynamic-tool'
				? 'toolName' in part && typeof part.toolName === 'string'
					? part.toolName
					: part.type
				: part.type.slice('tool-'.length),
		state,
		input: 'input' in part && isRecord(part.input) ? part.input : undefined,
		// Failed calls may carry an unfiltered provider error in either field.
		// Keep diagnostics out of the render model; ChatTool localizes the failure.
		output: state !== 'output-error' && 'output' in part ? part.output : undefined,
		toolCallId:
			'toolCallId' in part && typeof part.toolCallId === 'string' ? part.toolCallId : undefined
	};
}

export function toToolPhase(state: ToolPartState, isMessageInProgress: boolean): ToolPhase {
	if (state === 'output-available') return 'ran';
	if (state === 'output-error') return 'failed';
	return isMessageInProgress ? 'running' : 'failed';
}
