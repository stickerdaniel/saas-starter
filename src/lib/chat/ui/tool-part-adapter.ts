import type { MessagePart, MessageStatus, ToolPartState } from '../core/types.js';

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
 * the message failed or was aborted failed like an `output-error` did.
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

/**
 * The Convex agent stores a tool call in its own `success` row before the row that holds
 * its result, so a settled message alone does not end a call; only a failed one (which an
 * aborted stream also maps to) does.
 */
export function toToolPhase(state: ToolPartState, messageStatus: MessageStatus): ToolPhase {
	if (state === 'output-available') return 'ran';
	if (state === 'output-error') return 'failed';
	return messageStatus === 'failed' ? 'failed' : 'running';
}

/**
 * Output budgets, applied before the CodeBlock: highlighting, the rendered lines and the
 * copied text all stay bounded however large a result is. Shiki takes about 5 ms for 400
 * indented JSON lines and about 30 ms for a single 20 000-character line (measured), and
 * either is far more than the height-capped block shows.
 */
const TOOL_OUTPUT_MAX_CHARS = 20_000;
const TOOL_OUTPUT_MAX_LINES = 400;

export type ToolOutputCode = {
	code: string;
	language: 'text' | 'json';
	/** Whether a budget cut the output; the copy button copies the same capped `code`. */
	truncated: boolean;
};

/** Text output stays as is, any other value prints as indented JSON, both capped. */
export function formatToolOutput(output: unknown): ToolOutputCode {
	const isText = typeof output === 'string';
	const full = isText ? output : JSON.stringify(output, null, 2);
	// The character cut comes first, so the line split never walks an unbounded string.
	let code = full.slice(0, TOOL_OUTPUT_MAX_CHARS);
	const lines = code.split('\n');
	if (lines.length > TOOL_OUTPUT_MAX_LINES) code = lines.slice(0, TOOL_OUTPUT_MAX_LINES).join('\n');
	return { code, language: isText ? 'text' : 'json', truncated: code.length < full.length };
}
