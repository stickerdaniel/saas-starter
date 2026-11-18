/** Shared types of the chat library. */

import type { StreamArgs, SyncStreamsReturnValue } from '@convex-dev/agent';
import type { FunctionReference, PaginationResult } from 'convex/server';
import type { ProviderMetadata } from 'ai';
import {
	acceptAttribute,
	allowedMimeTypes,
	UPLOAD_PROFILES,
	type UploadProfile
} from '../../uploads/profiles';
import type { UploadErrorCode } from '../../uploads/transfer.js';

export type UploadState = {
	status: 'uploading' | 'success' | 'error';
	progress: number; // 0-100
	fileId?: string; // Convex fileId after success
	/**
	 * Why the upload failed, as a code rather than a message. Rendering
	 * translates it, so the reason survives a language switch and no English
	 * transport string can leak into the UI. Present only when status is 'error'.
	 */
	error?: UploadErrorCode;
};

export type Attachment =
	| {
			type: 'file';
			/** Stable identity for ComposerAttachmentCoordinator, whose updates and removals
			 * cannot rely on array indices while concurrent uploads shift them. */
			key?: string;
			name: string;
			size: number;
			mimeType: string;
			file?: File;
			preview?: string;
			url?: string;
			uploadState?: UploadState;
			width?: number;
			height?: number;
			/** Original filename before client-side preprocessing (e.g. WebP encode), for dedup. */
			sourceName?: string;
			/** Original byte size before client-side preprocessing, for dedup. */
			sourceSize?: number;
	  }
	| {
			type: 'screenshot';
			key?: string;
			name: string;
			size: number;
			mimeType: string;
			blob?: Blob;
			preview?: string;
			url?: string;
			uploadState?: UploadState;
			width?: number;
			height?: number;
			sourceName?: string;
			sourceSize?: number;
	  }
	| { type: 'image'; url: string; filename?: string; width?: number; height?: number }
	| {
			type: 'remote-file';
			url: string;
			filename: string;
			contentType?: string;
			width?: number;
			height?: number;
	  };

export type MessageStatus = 'pending' | 'success' | 'failed' | 'streaming';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/** Matches the Convex Agent message structure. */
export interface ChatMessage {
	id: string;
	_creationTime: number;
	threadId?: string;
	message?: {
		role: MessageRole;
		content: unknown; // string or a parts array
		providerOptions?: Record<string, unknown>;
	};
	text?: string; // Convenience field with full text content
	reasoning?: string; // Reasoning content (for models like DeepSeek R1)
	status: MessageStatus;
	order: number;
	tool?: boolean;
	agentName?: string;
	embeddingId?: string;
	model?: string;
	usage?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	key?: string;
	role: MessageRole; // Normalized
	parts?: MessagePart[];
	stepOrder?: number;
	localAttachments?: Attachment[];
}

/** Wire envelope shared by query producers, subscriptions, and optimistic consumers. */
export type MessagesQueryResponse = PaginationResult<ChatMessage> & {
	streams: SyncStreamsReturnValue;
};

export type ChatMessagesArgs = {
	threadId: string | null;
	anonymousUserId?: string;
	paginationOpts: { numItems: number; cursor: string | null };
	streamArgs?: StreamArgs;
};

// Public validators intentionally retain the Agent-owned `v.any()` envelope.
// Consumers normalize that unknown result to MessagesQueryResponse locally.
export type ChatMessagesQuery = FunctionReference<'query', 'public', ChatMessagesArgs, unknown>;

/** A message after stream processing. */
export interface DisplayMessage extends ChatMessage {
	displayText: string;
	displayReasoning: string;
	isStreaming: boolean;
	hasReasoningStream: boolean;
}

export type ToolPartType = `tool-${string}`;
export type ToolPartState =
	'input-streaming' | 'input-available' | 'output-available' | 'output-error';

/**
 * Tool UI part of an agent message, matching the AI SDK ToolUIPart: `type` is
 * "tool-{toolName}" (e.g. "tool-requestUserEmail"), and arguments are in
 * `input`.
 */
export interface ToolCallPart {
	type: ToolPartType;
	toolCallId: string;
	input?: Record<string, unknown>;
	state?: ToolPartState;
	output?: unknown;
	[key: string]: unknown;
}

export type TextUIPart = {
	type: 'text';
	text: string;
	state?: 'streaming' | 'done';
	providerMetadata?: ProviderMetadata;
};

export type ReasoningUIPart = {
	type: 'reasoning';
	text?: string;
	state?: 'streaming' | 'done';
	providerMetadata?: ProviderMetadata;
	streamPartId?: string;
};

export type MessagePart =
	TextUIPart | ReasoningUIPart | ToolCallPart | { type: string; [key: string]: unknown };

export type StreamStatus = 'streaming' | 'finished' | 'aborted';

export interface CreateThreadOptions {
	userId?: string;
	pageUrl?: string;
	title?: string;
}

export interface SendMessageOptions {
	fileIds?: string[];
	openWidgetAfter?: boolean;
	attachments?: Attachment[];
	userId?: string;
	createThreadOptions?: CreateThreadOptions;
}

export interface SendMessageResult {
	messageId: string;
	/** The saved prompt's order, which its reply or terminal notice shares. */
	order: number;
}

export interface ChatConfig {
	/** Number of messages to fetch per page */
	pageSize?: number;
	streamThrottleMs?: number;
}

/**
 * Optimistic updates must target the exact query args of the active
 * `listMessages` subscription, so every `createOptimisticUpdate` site and
 * ChatRoot's query use this constant.
 */
export const CHAT_PAGE_SIZE = 50;

export const DEFAULT_CHAT_CONFIG: Required<ChatConfig> = {
	pageSize: CHAT_PAGE_SIZE,
	streamThrottleMs: 100
};

/**
 * The upload policy of a chat surface whose upload config names no profile.
 *
 * The composer reads accepted types, MIME inference, size caps and the
 * attachment count from the surface's profile, so a surface with another
 * profile changes all of them together.
 */
export const DEFAULT_ATTACHMENT_PROFILE: UploadProfile = UPLOAD_PROFILES.chatAttachment;

/**
 * Upload constraints of the default chat attachment profile. The profile in
 * `#lib/uploads/profiles.js` is shared with the server validator, so the picker
 * and `validateUploadBlob` agree. These names are public API
 * (`#lib/chat/index.js`).
 */
export const ALLOWED_FILE_EXT_MIME: Readonly<Record<string, string>> =
	UPLOAD_PROFILES.chatAttachment.extensions;
export const ALLOWED_FILE_EXTENSIONS = acceptAttribute(UPLOAD_PROFILES.chatAttachment);
export const ALLOWED_FILE_TYPES = allowedMimeTypes(UPLOAD_PROFILES.chatAttachment);
export const MAX_FILE_SIZE = UPLOAD_PROFILES.chatAttachment.maxBytes;
export const MAX_FILE_SIZE_LABEL = UPLOAD_PROFILES.chatAttachment.maxBytesLabel;
/**
 * Ceiling for image inputs before client-side preprocessing.
 *
 * Images always shrink through processImage (resize to MAX_IMAGE_WIDTH and WebP
 * encode), so this limit only prevents OOM in createImageBitmap on low-memory
 * devices. 50MB is roughly where iPhone Safari decode starts to fail.
 */
export const MAX_INPUT_IMAGE_SIZE = 50 * 1024 * 1024;
export const MAX_INPUT_IMAGE_SIZE_LABEL = '50MB';
export const MAX_ATTACHMENTS = UPLOAD_PROFILES.chatAttachment.maxFiles;
export const MAX_MESSAGE_LENGTH = 2000;
