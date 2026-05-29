import type { TextStreamPart, ToolSet } from 'ai';
import type { StreamDelta } from '@convex-dev/agent/validators';
import type { UIMessage } from '@convex-dev/agent';
import { deriveUIMessagesFromTextStreamParts } from '../../src/lib/chat/core/stream-materialization.ts';
import { transformToDisplayMessage } from '../../src/lib/chat/core/DisplayMessageProcessor.ts';
import { StreamCacheManager } from '../../src/lib/chat/core/stream-cache.ts';
import type { ChatMessage } from '../../src/lib/chat/core/types.ts';
import type { MaterializedAssistant } from './types.ts';

/**
 * Run collected stream parts through the SAME pipeline the live chat UI uses
 * (deriveUIMessagesFromTextStreamParts -> transformToDisplayMessage). A capability
 * only counts as passing if its reasoning/tool/text parts survive this transform
 * in the shape the app renders, not just if the raw bytes arrived.
 */
export function materializeFromStreamParts(
	streamParts: Array<TextStreamPart<ToolSet>>,
	streamId = 'eval-stream-1'
): MaterializedAssistant {
	const streamMessage = {
		streamId,
		status: 'finished' as const,
		order: 1,
		stepOrder: 0,
		agentName: 'model-eval'
	};
	const delta: StreamDelta = {
		streamId,
		start: 0,
		end: streamParts.length,
		parts: streamParts as StreamDelta['parts']
	};

	const [uiMessages] = deriveUIMessagesFromTextStreamParts(
		'model-eval-thread',
		[streamMessage],
		[],
		[delta]
	);
	const uiMessage = uiMessages[0]!;

	const persisted: ChatMessage = {
		id: 'eval-assistant-1',
		_creationTime: Date.now(),
		role: 'assistant',
		status: 'success',
		order: 1,
		stepOrder: 0,
		text: uiMessage.text ?? '',
		parts: uiMessage.parts as ChatMessage['parts']
	};

	const display = transformToDisplayMessage(persisted, {
		streamMessageMap: new Map([[1, uiMessage]]),
		streamCache: new StreamCacheManager()
	});

	return {
		uiMessage,
		displayText: display.displayText,
		displayReasoning: display.displayReasoning,
		parts: (display.parts ?? uiMessage.parts) as UIMessage['parts']
	};
}
