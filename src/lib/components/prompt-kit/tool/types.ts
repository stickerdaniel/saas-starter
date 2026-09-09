export type ToolState = 'input-streaming' | 'input-available' | 'output-available' | 'output-error';

export type ToolPart = {
	type: string;
	state: ToolState;
	input?: Record<string, unknown>;
	output?: unknown;
	toolCallId?: string;
	errorText?: string;
};
