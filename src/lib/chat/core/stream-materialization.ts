import {
	readUIMessageStream,
	type ProviderMetadata,
	type TextStreamPart,
	type ToolSet,
	type UIMessageChunk
} from 'ai';
import type { UIMessage } from '@convex-dev/agent';
import type { StreamDelta, StreamMessage, MessageStatus } from '@convex-dev/agent/validators';
import type { ReasoningUIPart, TextUIPart, ToolCallPart } from './types.js';

/**
 * Extract text content from a stream delta part, handling both formats:
 * - UIMessageChunk format: content is in `delta` field
 * - TextStreamPart format: content is in `text` field
 */
function getDeltaText(part: { text?: string; delta?: string }): string {
	return (part as { delta?: string }).delta ?? part.text ?? '';
}

/**
 * Create a blank UIMessage from stream metadata
 */
export function blankUIMessage<METADATA = unknown>(
	streamMessage: StreamMessage & { metadata?: METADATA },
	threadId: string
): UIMessage<METADATA> {
	return {
		id: `stream:${streamMessage.streamId}`,
		key: `${threadId}-${streamMessage.order}-${streamMessage.stepOrder}`,
		order: streamMessage.order,
		stepOrder: streamMessage.stepOrder,
		status: statusFromStreamStatus(streamMessage.status),
		agentName: streamMessage.agentName,
		text: '',
		_creationTime: Date.now(),
		role: 'assistant',
		parts: [],
		...(streamMessage.metadata ? { metadata: streamMessage.metadata } : {})
	};
}

/**
 * Convert stream status to message status
 */
export function statusFromStreamStatus(
	status: StreamMessage['status']
): MessageStatus | 'streaming' {
	switch (status) {
		case 'streaming':
			return 'streaming';
		case 'finished':
			return 'success';
		case 'aborted':
			return 'failed';
		default:
			return 'pending';
	}
}

/**
 * Get parts from deltas with cursor tracking
 */
export function getParts<T extends StreamDelta['parts'][number]>(
	deltas: StreamDelta[],
	fromCursor?: number
): { parts: T[]; cursor: number } {
	const parts: T[] = [];
	let cursor = fromCursor ?? 0;
	for (const delta of deltas.sort((a, b) => a.start - b.start)) {
		if (delta.parts.length === 0) {
			continue;
		}
		if (cursor !== delta.start) {
			if (cursor >= delta.end) {
				continue;
			} else if (cursor < delta.start) {
				console.warn(
					`Got delta for stream ${delta.streamId} that has a gap ${cursor} -> ${delta.start}`
				);
				break;
			} else {
				throw new Error(
					`Got unexpected delta for stream ${delta.streamId}: delta: ${delta.start} -> ${delta.end} existing cursor: ${cursor}`
				);
			}
		}
		parts.push(...(delta.parts as T[]));
		cursor = delta.end;
	}
	return { parts, cursor };
}

/**
 * Merge provider metadata objects
 */
function mergeProviderMetadata(
	a: ProviderMetadata | undefined,
	b: ProviderMetadata | undefined
): ProviderMetadata | undefined {
	if (!a && !b) return undefined;
	return { ...a, ...b };
}

/**
 * Join text parts into a single string
 */
function joinText(parts: UIMessage['parts']): string {
	return parts
		.map((part) => {
			if (part.type === 'text') {
				return part.text;
			}
			return '';
		})
		.join('');
}

function asRecord(part: UIMessage['parts'][number]): Record<string, unknown> {
	return part as Record<string, unknown>;
}

function getStreamPartId(part: UIMessage['parts'][number]): string | undefined {
	const streamPartId = asRecord(part).streamPartId;
	return typeof streamPartId === 'string' ? streamPartId : undefined;
}

/**
 * Whether the part comes from a live materialization rather than a persisted
 * reconstruction. Only a live snapshot carries the AI SDK's part id, so only
 * there does its lifecycle `state` report what the model actually did.
 */
function carriesStreamIdentity(part: UIMessage['parts'][number]): boolean {
	const record = asRecord(part);
	return typeof record.streamPartId === 'string' || typeof record.id === 'string';
}

function getReasoningPartId(part: UIMessage['parts'][number]): string | undefined {
	if (part.type !== 'reasoning') return undefined;

	const record = asRecord(part);
	const streamPartId = record.streamPartId;
	if (typeof streamPartId === 'string') {
		return streamPartId;
	}

	const id = record.id;
	return typeof id === 'string' ? id : undefined;
}

/**
 * A statically named tool call. A runtime-registered one carries the same
 * `toolCallId` but spells its type `dynamic-tool`, so the two views of one such
 * call are not matched and both are kept (issue #894). Matching them here is not
 * enough on its own: the two views also disagree on the type itself, and the
 * merged part then names a type the renderer drops.
 */
function isToolUIPart(part: UIMessage['parts'][number]): boolean {
	return part.type.startsWith('tool-') && typeof asRecord(part).toolCallId === 'string';
}

/**
 * Update a UIMessage from UIMessageChunk deltas using the AI SDK chunk reader.
 */
export async function updateFromUIMessageChunks(
	uiMessage: UIMessage,
	parts: UIMessageChunk[]
): Promise<UIMessage> {
	const partsStream = new ReadableStream<UIMessageChunk>({
		start(controller) {
			for (const part of parts) {
				controller.enqueue(part);
			}
			controller.close();
		}
	});

	let failed = false;
	const messageStream = readUIMessageStream({
		message: uiMessage,
		stream: partsStream,
		onError: (error) => {
			failed = true;
			console.error('Error in UI message stream', error);
		},
		terminateOnError: true
	});

	let message = uiMessage;
	for await (const nextMessage of messageStream) {
		if (nextMessage.id !== message.id) {
			throw new Error('Expected exactly one UI message per stream');
		}
		message = nextMessage;
	}

	if (failed) {
		message.status = 'failed';
	}
	message.text = joinText(message.parts);
	return message;
}

/**
 * Update UIMessage from text stream parts
 */
export function updateFromTextStreamParts(
	threadId: string,
	streamMessage: StreamMessage,
	existing: { streamId: string; cursor: number; message: UIMessage } | undefined,
	deltas: StreamDelta[]
): [{ streamId: string; cursor: number; message: UIMessage }, boolean] {
	const { cursor, parts } = getParts<TextStreamPart<ToolSet>>(deltas, existing?.cursor);
	const changed =
		parts.length > 0 ||
		(existing && statusFromStreamStatus(streamMessage.status) !== existing.message.status);
	const existingMessage = existing?.message ?? blankUIMessage(streamMessage, threadId);

	if (!changed) {
		return [
			existing ?? {
				streamId: streamMessage.streamId,
				cursor,
				message: existingMessage
			},
			false
		];
	}

	const message: UIMessage = structuredClone(existingMessage);
	message.status = statusFromStreamStatus(streamMessage.status);

	const textPartsById = new Map<string, TextUIPart>();
	const reasoningPartsById = new Map<string, ReasoningUIPart & { streamPartId: string }>();

	for (const existingPart of message.parts) {
		const streamPartId = getStreamPartId(existingPart);
		if (existingPart.type === 'reasoning' && streamPartId) {
			reasoningPartsById.set(
				streamPartId,
				existingPart as ReasoningUIPart & { streamPartId: string }
			);
		}
	}

	for (const part of parts) {
		switch (part.type) {
			case 'text-start':
			case 'text-delta': {
				if (!textPartsById.has(part.id)) {
					const lastPart =
						message.parts.length > 0 ? message.parts[message.parts.length - 1] : undefined;
					if (lastPart?.type === 'text') {
						textPartsById.set(part.id, lastPart);
					} else {
						const newPart = {
							type: 'text',
							text: '',
							providerMetadata: part.providerMetadata
						} satisfies TextUIPart;
						textPartsById.set(part.id, newPart);
						message.parts.push(newPart);
					}
				}
				if (part.type === 'text-delta') {
					const textPart = textPartsById.get(part.id)!;
					textPart.text += getDeltaText(part);
					textPart.providerMetadata = mergeProviderMetadata(
						textPart.providerMetadata,
						part.providerMetadata
					);
				}
				break;
			}
			case 'reasoning-start':
			case 'reasoning-delta': {
				if (!reasoningPartsById.has(part.id)) {
					const newPart = {
						type: 'reasoning',
						text: '',
						state: 'streaming',
						providerMetadata: part.providerMetadata,
						streamPartId: part.id
					} satisfies ReasoningUIPart & { streamPartId: string };
					reasoningPartsById.set(part.id, newPart);
					message.parts.push(newPart);
				}
				if (part.type === 'reasoning-delta') {
					const reasoningPart = reasoningPartsById.get(part.id)!;
					reasoningPart.text = (reasoningPart.text ?? '') + getDeltaText(part);
					reasoningPart.providerMetadata = mergeProviderMetadata(
						reasoningPart.providerMetadata,
						part.providerMetadata
					);
				}
				break;
			}
			case 'tool-call': {
				const toolPartType = `tool-${part.toolName}` as const;
				const existingToolPart = message.parts.find(
					(existingPart) =>
						existingPart.type === toolPartType && getToolCallId(existingPart) === part.toolCallId
				);

				if (existingToolPart) {
					const toolPart = existingToolPart as ToolCallPart;
					toolPart.input = part.input;
					toolPart.state = 'input-available';
				} else {
					const newToolPart = {
						type: toolPartType,
						toolCallId: part.toolCallId,
						input: part.input,
						state: 'input-available'
					} satisfies ToolCallPart;
					message.parts.push(newToolPart);
				}
				break;
			}
			case 'tool-result': {
				const matchingToolPart = message.parts.find(
					(existingPart) => getToolCallId(existingPart) === part.toolCallId
				);

				if (matchingToolPart) {
					const toolPart = matchingToolPart as ToolCallPart;
					if (part.input !== undefined) {
						toolPart.input = part.input;
					}
					toolPart.output = part.output;
					toolPart.state = 'output-available';
				}
				break;
			}
			case 'reasoning-end': {
				const reasoningPart = reasoningPartsById.get(part.id);
				if (reasoningPart) {
					reasoningPart.state = 'done';
					reasoningPart.providerMetadata = mergeProviderMetadata(
						reasoningPart.providerMetadata,
						part.providerMetadata
					);
				}
				break;
			}
		}
	}

	message.text = joinText(message.parts);
	return [{ streamId: streamMessage.streamId, cursor, message }, true];
}

/**
 * Derive UIMessages from text stream parts
 *
 * Main entry point for processing streaming deltas into displayable messages
 */
export function deriveUIMessagesFromTextStreamParts(
	threadId: string,
	streamMessages: StreamMessage[],
	existingStreams: Array<{
		streamId: string;
		cursor: number;
		message: UIMessage;
	}>,
	allDeltas: StreamDelta[]
): [UIMessage[], Array<{ streamId: string; cursor: number; message: UIMessage }>, boolean] {
	const newStreams: Array<{
		streamId: string;
		cursor: number;
		message: UIMessage;
	}> = [];
	let changed = false;
	for (const streamMessage of streamMessages) {
		const deltas = allDeltas.filter((d) => d.streamId === streamMessage.streamId);
		const existing = existingStreams.find((s) => s.streamId === streamMessage.streamId);
		const [newStream, messageChanged] = updateFromTextStreamParts(
			threadId,
			streamMessage,
			existing,
			deltas
		);
		newStreams.push(newStream);
		if (messageChanged) changed = true;
	}
	for (const { streamId } of existingStreams) {
		if (!newStreams.find((stream) => stream.streamId === streamId)) {
			changed = true;
		}
	}
	const messages = newStreams
		.map((stream) => stream.message)
		.sort((a, b) => {
			if (a.order !== b.order) return a.order - b.order;
			return a.stepOrder - b.stepOrder;
		});
	return [messages, newStreams, changed];
}

/**
 * Decode stream deltas using the format declared on each stream.
 */
export async function deriveUIMessagesFromDeltas(
	threadId: string,
	streamMessages: StreamMessage[],
	allDeltas: StreamDelta[]
): Promise<UIMessage[]> {
	const messages = await Promise.all(
		streamMessages.map(async (streamMessage) => {
			const deltas = allDeltas.filter((delta) => delta.streamId === streamMessage.streamId);
			if (streamMessage.format === 'UIMessageChunk') {
				const { parts } = getParts<UIMessageChunk>(deltas, 0);
				return updateFromUIMessageChunks(blankUIMessage(streamMessage, threadId), parts);
			}

			const [uiMessages] = deriveUIMessagesFromTextStreamParts(
				threadId,
				[streamMessage],
				[],
				deltas
			);
			return uiMessages[0]!;
		})
	);

	return messages.sort((a, b) => {
		if (a.order !== b.order) return a.order - b.order;
		return a.stepOrder - b.stepOrder;
	});
}

/**
 * Combine streamed assistant steps so they match the grouped saved-message shape.
 *
 * Mirrors the upstream @convex-dev/agent `combineUIMessages` grouping semantics:
 * repeated assistant steps with the same order collapse into one grouped UI message.
 *
 * Two streams of one order do not occur here today: `@convex-dev/agent` opens one
 * delta stream per `streamText` call with a fixed `stepOrder` and one call covers
 * every step, both the AI chat and the support agent schedule one generation per
 * prompt, and only streams with status `streaming` are materialized. Should that
 * shape ever arrive, the merge below would apply heuristics written for the
 * persisted and live pair of one stream to two unrelated ones, whose parts share
 * no content to match on; upstream concatenates the non-tool parts instead.
 */
export function combineStreamingUIMessages(messages: UIMessage[]): UIMessage[] {
	const sortedMessages = [...messages].sort((a, b) => {
		if (a.order !== b.order) return a.order - b.order;
		return a.stepOrder - b.stepOrder;
	});

	return sortedMessages.reduce<UIMessage[]>((combined, message) => {
		const previous = combined.length > 0 ? combined[combined.length - 1] : undefined;
		if (
			!previous ||
			message.order !== previous.order ||
			previous.role !== message.role ||
			message.role !== 'assistant'
		) {
			combined.push(structuredClone(message));
			return combined;
		}

		const mergedParts = mergeAssistantMessageParts(previous.parts, message.parts);

		combined[combined.length - 1] = {
			...previous,
			status: message.status,
			metadata: message.metadata ?? previous.metadata,
			agentName: message.agentName ?? previous.agentName,
			parts: mergedParts,
			text: joinText(mergedParts)
		};
		return combined;
	}, []);
}

export function mergeAssistantMessageParts(
	existingParts: UIMessage['parts'],
	incomingParts: UIMessage['parts']
): UIMessage['parts'] {
	if (existingParts.length === 0) return [...incomingParts];
	if (incomingParts.length === 0) return [...existingParts];

	const compatiblePrefixLength = getCompatiblePrefixLength(existingParts, incomingParts);
	// A prefix of step separators alone is no evidence that the two sides are
	// snapshots of one sequence. Every step opens with one, so two steps that
	// share nothing else still agree on it, and the shortcut would then drop
	// every block the existing side holds behind that separator. At least one
	// part carrying an id, a tool call or text has to line up first.
	//
	// A tool call behind the prefix rules the shortcut out as well. It closes the
	// step the prefix belongs to, and an incoming side that ends before it is a
	// later step whose opening words repeat the closed one, because text parts
	// carry no id to tell the two apart. Taking the shortcut there overwrote the
	// closed step's text and moved the later step in front of the tool call, so
	// that input goes through the fallback, which keeps the tool boundary.
	const prefixCarriesContent = existingParts
		.slice(0, compatiblePrefixLength)
		.some((part) => part.type !== 'step-start');

	if (prefixCarriesContent && !hasToolPartAfter(existingParts, compatiblePrefixLength - 1)) {
		const mergedPrefix = existingParts
			.slice(0, compatiblePrefixLength)
			.map((part, index) => mergeMatchedParts(part, incomingParts[index]!));

		const tail =
			incomingParts.length > compatiblePrefixLength
				? incomingParts.slice(compatiblePrefixLength)
				: existingParts.slice(compatiblePrefixLength);

		return [...mergedPrefix, ...tail];
	}

	const mergedParts = [...existingParts];
	// Blocks this snapshot has already spoken for, either by merging into them or
	// by contributing them. One block can only be the continuation of one other,
	// and without this a second incoming part whose text also grows out of the
	// same block would swallow the first.
	const claimedIndices = new Set<number>();
	// The block the last incoming part matched. Everything the next one can
	// continue sits behind it, because both sides list their blocks in the order
	// the model produced them. A part this snapshot contributes leaves the cursor
	// where it is, so a separator appended to the tail cannot hide the blocks that
	// are still waiting for their continuation.
	let cursor = -1;

	for (const [incomingIndex, part] of incomingParts.entries()) {
		const toolCallId = getToolCallId(part);
		if (toolCallId) {
			const existingIndex = mergedParts.findIndex(
				(existingPart) => getToolCallId(existingPart) === toolCallId
			);

			if (existingIndex === -1) {
				claimedIndices.add(mergedParts.length);
				mergedParts.push(part);
			} else {
				mergedParts[existingIndex] = mergeStreamParts(mergedParts[existingIndex]!, part);
				claimedIndices.add(existingIndex);
				cursor = Math.max(cursor, existingIndex);
			}
			continue;
		}

		if (part.type === 'reasoning' || part.type === 'text') {
			if (part.type === 'reasoning') {
				const reasoningPartId = getReasoningPartId(part);
				const existingIndex = reasoningPartId
					? mergedParts.findIndex(
							(existingPart) => getReasoningPartId(existingPart) === reasoningPartId
						)
					: -1;

				if (existingIndex !== -1) {
					mergedParts[existingIndex] = mergeMatchedParts(mergedParts[existingIndex]!, part);
					claimedIndices.add(existingIndex);
					cursor = Math.max(cursor, existingIndex);
					continue;
				}
			}

			const counterpartIndex = findCounterpart(
				mergedParts,
				part,
				claimedIndices,
				cursor,
				hasToolPartAfter(incomingParts, incomingIndex)
			);
			if (counterpartIndex !== -1) {
				mergedParts[counterpartIndex] = mergeMatchedParts(mergedParts[counterpartIndex]!, part);
				claimedIndices.add(counterpartIndex);
				cursor = Math.max(cursor, counterpartIndex);
				continue;
			}
		}

		claimedIndices.add(mergedParts.length);
		mergedParts.push(part);
	}

	return mergedParts;
}

/**
 * The block an incoming reasoning or text part continues, when no streaming id
 * connects the two, or -1 when it opens a block of its own.
 *
 * The two sides carry the id inconsistently, which is what left one block
 * rendering twice: a persisted message reconstructs reasoning without any id
 * (`UIMessages.ts` in `@convex-dev/agent`), while the live stream stamps one on
 * (`id` from the AI SDK, `streamPartId` from the legacy decoder). An id lookup
 * across that pair matches nothing, so a text search is the only thing that can
 * recognize the block, and without it the part falls through to the push and
 * appends a second copy of what is already there.
 *
 * That search runs in order, from `cursor + 1`, and takes the first compatible
 * block it finds. Both producers list reasoning and text in the order the model
 * wrote them, and a live snapshot always carries whole steps, so the block the
 * previous incoming part settled on is where the next one starts looking. A
 * search that weighed the candidates instead let a short opening block claim the
 * longer one further down, which left the block that owned it with nothing to
 * merge into and appended it a second time.
 *
 * `cursor` moves on a match alone. A live snapshot opens each of its steps with
 * a `step-start` the persisted side has no counterpart for, so that separator
 * gets pushed onto the tail; moving the cursor there would carry the search past
 * every block still waiting for its continuation.
 *
 * A block another part of the same snapshot already claimed is off limits, so
 * two blocks growing out of the same opening words cost a missed merge and never
 * a lost block. An empty incoming block never adopts a block that already
 * carries text, because that would hand its id to text belonging to a block
 * already finished. Two empty blocks in order are the same block that has only
 * just opened on both sides: the provider opens one with an empty delta for a
 * signature-only reasoning detail, and the persisted row keeps it, so rejecting
 * every empty block rendered that one twice while the stream was open.
 *
 * `incomingPrecedesTool` carries the only ordering evidence the two sides share.
 * Reasoning comes before its own step's tool calls, so a block with a tool call
 * behind it is closed. An incoming part that also has one behind it can be that
 * same closed block. One that has none can only be it while its text is a prefix
 * of the block's, because a snapshot lagging one tool chunk behind holds a
 * shorter copy of the words the block already has, and a later step that repeats
 * those opening words extends them instead. Without the prefix condition, that
 * later step would merge into the closed block and move itself in front of the
 * tool call that ran between them.
 *
 * The price is a later step whose text is still a strict prefix of the block a
 * tool call closed, which only two streams of one order combined can produce: it
 * stays inside that closed block until its words grow past the ones they share,
 * and nothing renders twice while it does. Only two streams of one order can
 * produce it, which `combineStreamingUIMessages` above records as unreachable, so
 * the rule is tuned for the one race that is reachable: the delta snapshot
 * lagging one tool chunk behind the page.
 */
function findCounterpart(
	parts: UIMessage['parts'],
	incomingPart: UIMessage['parts'][number],
	claimedIndices: ReadonlySet<number>,
	cursor: number,
	incomingPrecedesTool: boolean
): number {
	const incomingText = getPartText(incomingPart);
	const incomingId = getReasoningPartId(incomingPart);

	for (let index = cursor + 1; index < parts.length; index += 1) {
		if (claimedIndices.has(index)) continue;

		const candidate = parts[index]!;
		if (candidate.type !== incomingPart.type) continue;
		if (!incomingPrecedesTool && hasToolPartAfter(parts, index)) {
			// The words of a later step repeat the closed block and grow past it,
			// while a snapshot that lags one tool chunk behind stops short of it. Only
			// the second one is this block, so the first stays behind the tool call
			// and the second grows the block again instead of rendering a copy of it
			// on the other side of the tool card.
			if (!getPartText(candidate).startsWith(incomingText)) continue;
		}
		if (incomingText.length === 0 && getPartText(candidate).length > 0) continue;
		// Two ids that disagree are two blocks, whatever the texts look like. A
		// pair that shares one was already merged by the id lookup, so only the
		// mixed case reaches the text heuristic.
		if (incomingId !== undefined && getReasoningPartId(candidate) !== undefined) continue;

		if (!areTextsCompatible(getPartText(candidate), incomingText)) continue;

		return index;
	}

	return -1;
}

/** Whether a tool call closes the step the part at `index` belongs to. */
function hasToolPartAfter(parts: UIMessage['parts'], index: number): boolean {
	for (let cursor = index + 1; cursor < parts.length; cursor += 1) {
		if (getToolCallId(parts[cursor]!)) return true;
	}

	return false;
}

function mergeMatchedParts(
	existingPart: UIMessage['parts'][number],
	incomingPart: UIMessage['parts'][number]
): UIMessage['parts'][number] {
	const carriesText =
		existingPart.type === incomingPart.type &&
		(existingPart.type === 'reasoning' || existingPart.type === 'text');
	if (!carriesText) {
		return mergeStreamParts(existingPart, incomingPart);
	}

	const merged = { ...mergeStreamParts(existingPart, incomingPart) } as Record<string, unknown>;
	const existingText = getPartText(existingPart);

	// The id belongs to the live snapshot, which goes away at the handover, and
	// the persisted reconstruction has none of its own. A borrowed one reads as a
	// live part to every consumer that matches on it, such as the delta
	// application keyed by stream part id.
	if (existingPart.type === 'reasoning' && getReasoningPartId(existingPart) === undefined) {
		delete merged.streamPartId;
		delete merged.id;
	}

	// The persisted row and the live stream reach the renderer through two
	// independent reactive queries, so either side can be the older snapshot.
	// Field-wise merging takes the incoming value wherever it is defined, which
	// shortens a reasoning block or a finished answer whenever the live side is
	// the older one and grows it back on the next frame. Text and state come from
	// the same side, because text that is already complete must not fall back to
	// a spinner.
	const incomingText = getPartText(incomingPart);
	if (existingText.length > incomingText.length) {
		merged.text = existingText;
		const existingState = asRecord(existingPart).state;
		if (existingState !== undefined) {
			merged.state = existingState;
		}
	} else if (
		existingText.length === incomingText.length &&
		asRecord(existingPart).state === 'done' &&
		carriesStreamIdentity(existingPart)
	) {
		// `reasoning-end` and `text-end` close a block without adding to its text, so
		// the two snapshots read identically and length cannot say which is newer.
		// A `done` means the block really closed only on a live snapshot: the message
		// list materializes an active stream into its own page, so this side is a
		// second live view that can be the newer one. The persisted reconstruction
		// stamps `done` on everything it rebuilds, including a step still running
		// (measured), and carries no id, which is what tells the two apart.
		//
		// Only reasoning is covered, because only reasoning carries that id: a live
		// text part holds nothing but its type, text and state (measured), so a
		// settled answer can still be handed back its streaming presentation for one
		// frame. Separating the two would need the caller to say which view each side
		// came from, which is issue #893 rather than another guess here.
		merged.state = 'done';
	}

	return merged as UIMessage['parts'][number];
}

function getCompatiblePrefixLength(
	existingParts: UIMessage['parts'],
	incomingParts: UIMessage['parts']
): number {
	const maxLength = Math.min(existingParts.length, incomingParts.length);
	let index = 0;

	while (index < maxLength && arePartsCompatible(existingParts[index]!, incomingParts[index]!)) {
		index += 1;
	}

	return index;
}

function arePartsCompatible(
	existingPart: UIMessage['parts'][number],
	incomingPart: UIMessage['parts'][number]
): boolean {
	if (existingPart.type !== incomingPart.type) return false;

	if (existingPart.type === 'step-start') {
		return true;
	}

	const existingToolCallId = getToolCallId(existingPart);
	const incomingToolCallId = getToolCallId(incomingPart);
	if (existingToolCallId || incomingToolCallId) {
		return existingToolCallId === incomingToolCallId;
	}

	const existingReasoningId = getReasoningPartId(existingPart);
	const incomingReasoningId = getReasoningPartId(incomingPart);
	if (existingReasoningId || incomingReasoningId) {
		return existingReasoningId === incomingReasoningId;
	}

	if (existingPart.type === 'text' || existingPart.type === 'reasoning') {
		return areTextsCompatible(getPartText(existingPart), getPartText(incomingPart));
	}

	return false;
}

function getPartText(part: UIMessage['parts'][number]): string {
	const text = asRecord(part).text;
	return typeof text === 'string' ? text : '';
}

function areTextsCompatible(existingText: string, incomingText: string): boolean {
	if (existingText.length === 0 || incomingText.length === 0) return true;
	return existingText.startsWith(incomingText) || incomingText.startsWith(existingText);
}

function getToolCallId(part: UIMessage['parts'][number]) {
	return isToolUIPart(part) ? (asRecord(part).toolCallId as string) : undefined;
}

/**
 * The states that end a tool call. A denied call is as final as a returned or
 * failed one: the AI SDK settles it there and the persisted reconstruction
 * rebuilds it as a denial, so letting a lagging snapshot pull it back to
 * `approval-requested` would ask the reader to decide something they already
 * decided.
 */
const TERMINAL_TOOL_STATES = new Set(['output-available', 'output-error', 'output-denied']);

function isSettledToolPart(part: UIMessage['parts'][number]): boolean {
	if (!isToolUIPart(part)) return false;
	const state = asRecord(part).state;
	return typeof state === 'string' && TERMINAL_TOOL_STATES.has(state);
}

function mergeStreamParts(
	previousPart: UIMessage['parts'][number],
	part: UIMessage['parts'][number]
): UIMessage['parts'][number] {
	// A tool call runs once, so its result is the end of the sequence and the
	// snapshot holding one is the newer of the two whichever way they arrived.
	// Field-wise merging would take the incoming `input-streaming` and leave it
	// next to the output the other side already had, which renders as a spinner
	// above a finished result.
	if (isSettledToolPart(previousPart) && !isSettledToolPart(part)) {
		return previousPart;
	}

	const merged: Record<string, unknown> = { ...previousPart };
	for (const [key, value] of Object.entries(part)) {
		if (value !== undefined) {
			merged[key] = value;
		}
	}
	return merged as UIMessage['parts'][number];
}
