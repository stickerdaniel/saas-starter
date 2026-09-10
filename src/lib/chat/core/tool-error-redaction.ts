import type { LanguageModelV4, LanguageModelV4StreamPart } from '@ai-sdk/provider';
import type { UIMessage } from '@convex-dev/agent';
import type { MessageDoc, StreamDelta } from '@convex-dev/agent/validators';
import type { ModelMessage, StreamTextTransform, TextStreamPart, ToolSet } from 'ai';

export const SAFE_TOOL_ERROR_MESSAGE = 'Tool execution failed.';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function redactToolResultOutput(output: unknown, forcedError: boolean): unknown {
	if (!isRecord(output)) return forcedError ? SAFE_TOOL_ERROR_MESSAGE : output;

	const type = output.type;
	if (type === 'error-text' || type === 'error-json' || (forcedError && type === 'text')) {
		return { ...output, value: SAFE_TOOL_ERROR_MESSAGE };
	}
	if (forcedError && type === 'json') {
		return { ...output, value: SAFE_TOOL_ERROR_MESSAGE };
	}
	if (forcedError && type === 'content') {
		return { ...output, value: [{ type: 'text', text: SAFE_TOOL_ERROR_MESSAGE }] };
	}

	return forcedError ? { type: 'error-text', value: SAFE_TOOL_ERROR_MESSAGE } : output;
}

function redactToolResultPart(
	part: UnknownRecord,
	inheritedError = false,
	interpretSerializedErrorOutput = true
): UnknownRecord {
	if (part.type !== 'tool-result') return part;

	const outputType = isRecord(part.output) ? part.output.type : undefined;
	const markedError =
		inheritedError ||
		part.isError === true ||
		(interpretSerializedErrorOutput &&
			(outputType === 'error-text' || outputType === 'error-json'));
	if (!markedError) return part;

	return {
		...part,
		isError: true,
		...('output' in part
			? { output: redactToolResultOutput(part.output, inheritedError || part.isError === true) }
			: {}),
		...('result' in part ? { result: SAFE_TOOL_ERROR_MESSAGE } : {})
	};
}

function redactContent(content: unknown, inheritedError = false): unknown {
	if (!Array.isArray(content)) return content;
	let changed = false;
	const redacted = content.map((part) => {
		if (!isRecord(part)) return part;
		const next = redactToolResultPart(part, inheritedError);
		if (next !== part) changed = true;
		return next;
	});
	return changed ? redacted : content;
}

export function redactMessageDocToolErrors<T extends MessageDoc>(message: T): T {
	const hasMessageError = typeof message.error === 'string';
	const content = message.message?.content;
	const redactedContent = redactContent(content, hasMessageError);
	if (!hasMessageError && redactedContent === content) return message;

	return {
		...message,
		...(hasMessageError ? { error: SAFE_TOOL_ERROR_MESSAGE } : {}),
		...(message.message && redactedContent !== content
			? { message: { ...message.message, content: redactedContent } }
			: {})
	} as T;
}

export function redactModelMessages(messages: ModelMessage[]): ModelMessage[] {
	return messages.map((message) => {
		const content = redactContent(message.content);
		return content === message.content ? message : ({ ...message, content } as ModelMessage);
	});
}

export function prepareToolErrorRedactionStep(options: { messages: ModelMessage[] }) {
	return { messages: redactModelMessages(options.messages) };
}

function isErrorStateToolPart(part: UnknownRecord & { type: string }): boolean {
	return (
		(part.type === 'dynamic-tool' || part.type.startsWith('tool-')) && part.state === 'output-error'
	);
}

export function redactToolErrorStreamPart<T extends { type: string }>(part: T): T {
	if (part.type === 'tool-error') {
		return { ...part, error: SAFE_TOOL_ERROR_MESSAGE };
	}
	if (part.type === 'tool-call' && 'invalid' in part && part.invalid === true) {
		return { ...part, error: SAFE_TOOL_ERROR_MESSAGE };
	}
	if (part.type === 'error') {
		return {
			...part,
			...('error' in part ? { error: SAFE_TOOL_ERROR_MESSAGE } : {}),
			...('errorText' in part ? { errorText: SAFE_TOOL_ERROR_MESSAGE } : {})
		};
	}
	if (part.type === 'tool-input-error' || part.type === 'tool-output-error') {
		return { ...part, errorText: SAFE_TOOL_ERROR_MESSAGE };
	}
	if (part.type === 'abort' && 'reason' in part && typeof part.reason === 'string') {
		return { ...part, reason: SAFE_TOOL_ERROR_MESSAGE };
	}
	if (part.type === 'tool-result') {
		return redactToolResultPart(part, false, false) as T;
	}
	if (isErrorStateToolPart(part)) {
		return {
			...part,
			errorText: SAFE_TOOL_ERROR_MESSAGE,
			...('output' in part ? { output: SAFE_TOOL_ERROR_MESSAGE } : {})
		};
	}
	return part;
}

function redactProviderStream(
	stream: ReadableStream<LanguageModelV4StreamPart>
): ReadableStream<LanguageModelV4StreamPart> {
	const reader = stream.getReader();
	return new ReadableStream({
		async pull(controller) {
			try {
				const { done, value } = await reader.read();
				if (done) {
					controller.close();
					return;
				}
				controller.enqueue(redactToolErrorStreamPart(value));
			} catch {
				controller.error(new Error(SAFE_TOOL_ERROR_MESSAGE));
			}
		},
		cancel() {
			return reader.cancel(SAFE_TOOL_ERROR_MESSAGE);
		}
	});
}

/**
 * Agent observes provider stream errors before SDK transforms run. Wrap the V4
 * model itself so its failure callbacks can persist only the fixed diagnostic.
 */
export function redactLanguageModelProviderErrors(model: LanguageModelV4): LanguageModelV4 {
	return {
		specificationVersion: 'v4',
		provider: model.provider,
		modelId: model.modelId,
		supportedUrls: model.supportedUrls,
		async doGenerate(options) {
			try {
				return await model.doGenerate(options);
			} catch {
				throw new Error(SAFE_TOOL_ERROR_MESSAGE);
			}
		},
		async doStream(options) {
			try {
				const result = await model.doStream(options);
				return { ...result, stream: redactProviderStream(result.stream) };
			} catch {
				throw new Error(SAFE_TOOL_ERROR_MESSAGE);
			}
		}
	};
}

export const toolErrorRedactionTransform: StreamTextTransform<ToolSet> = () =>
	new TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>>({
		transform(part, controller) {
			controller.enqueue(redactToolErrorStreamPart(part));
		}
	});

export function redactStreamDeltas<T extends StreamDelta>(deltas: T[]): T[] {
	return deltas.map((delta) => {
		let changed = false;
		const parts = delta.parts.map((part) => {
			if (!isRecord(part) || typeof part.type !== 'string') return part;
			const redacted = redactToolErrorStreamPart(part as UnknownRecord & { type: string });
			if (redacted !== part) changed = true;
			return redacted;
		});
		return changed ? ({ ...delta, parts } as T) : delta;
	});
}

export function redactToolErrorParts<T extends { type: string }>(parts: T[]): T[] {
	let changed = false;
	const redactedParts = parts.map((part) => {
		const redacted = redactToolErrorStreamPart(part);
		if (redacted !== part) changed = true;
		return redacted;
	});
	return changed ? redactedParts : parts;
}

export function redactUIMessageToolErrors<T extends UIMessage>(message: T): T {
	const parts = redactToolErrorParts(message.parts);
	return parts === message.parts ? message : ({ ...message, parts } as T);
}
