/**
 * Chat core types
 *
 * This module contains all shared TypeScript types for the chat library.
 * Types are extracted from the customer-support implementation to be reusable.
 */

import type { ProviderMetadata } from 'ai';

/**
 * Upload state for tracking file upload progress
 */
export type UploadState = {
	status: 'uploading' | 'success' | 'error';
	progress: number; // 0-100
	fileId?: string; // Convex fileId after success
	error?: string; // Error message if failed
};

/**
 * Unified attachment type supporting both files and screenshots
 */
export type Attachment =
	| {
			type: 'file';
			/** Stable identity used by ChatUIContext to update/remove this entry while
			 * concurrent uploads or user removals shift array indices. */
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
			/** Original filename before client-side preprocessing (e.g. WebP encode). Used for dedup. */
			sourceName?: string;
			/** Original byte size before client-side preprocessing. Used for dedup. */
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

/**
 * Message status
 */
export type MessageStatus = 'pending' | 'success' | 'failed' | 'streaming';

/**
 * Message role
 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * Chat message interface matching Convex Agent message structure
 */
export interface ChatMessage {
	id: string;
	_creationTime: number;
	threadId?: string;
	message?: {
		role: MessageRole;
		content: unknown; // Can be string or complex array structure
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
	// Additional UIMessage fields
	key?: string;
	role: MessageRole; // Required (normalized)
	parts?: MessagePart[];
	stepOrder?: number;
	// Optimistic attachments
	localAttachments?: Attachment[];
}

/**
 * Message with display fields (after stream processing)
 */
export interface DisplayMessage extends ChatMessage {
	displayText: string;
	displayReasoning: string;
	isStreaming: boolean;
	hasReasoningStream: boolean;
}

export type ToolPartType = `tool-${string}`;
export type ToolPartState =
	| 'input-streaming'
	| 'input-available'
	| 'output-available'
	| 'output-error';

/**
 * Tool UI part from agent messages
 *
 * When an agent calls a tool, the UIMessage contains tool parts with
 * type "tool-{toolName}" format (e.g., "tool-requestUserEmail").
 *
 * Note: This matches the ToolUIPart from the AI SDK, where:
 * - type is "tool-{toolName}" (not "tool-call")
 * - arguments are in "input" (not "args")
 */
export interface ToolCallPart {
	type: ToolPartType;
	toolCallId: string;
	input?: Record<string, unknown>; // Tool arguments
	state?: ToolPartState;
	output?: unknown;
	[key: string]: unknown;
}

/**
 * Text UI part
 */
export type TextUIPart = {
	type: 'text';
	text: string;
	providerMetadata?: ProviderMetadata;
};

/**
 * Reasoning UI part
 */
export type ReasoningUIPart = {
	type: 'reasoning';
	text?: string;
	state?: 'streaming' | 'done';
	providerMetadata?: ProviderMetadata;
	streamPartId?: string;
};

/**
 * Extended message part types
 */
export type MessagePart =
	| TextUIPart
	| ReasoningUIPart
	| ToolCallPart
	| { type: string; [key: string]: unknown };

/**
 * Pagination state
 */
export interface PaginationState {
	hasMore: boolean;
	continueCursor: string | null;
	isLoadingMore: boolean;
}

/**
 * Stream status
 */
export type StreamStatus = 'streaming' | 'finished' | 'aborted';

/**
 * Options for creating a thread
 */
export interface CreateThreadOptions {
	userId?: string;
	pageUrl?: string;
	title?: string;
}

/**
 * Options for sending a message
 */
export interface SendMessageOptions {
	fileIds?: string[];
	openWidgetAfter?: boolean;
	attachments?: Attachment[];
	userId?: string;
	/** Options for creating a thread if none exists */
	createThreadOptions?: CreateThreadOptions;
}

/**
 * Result from sending a message
 */
export interface SendMessageResult {
	messageId: string;
}

/**
 * Chat configuration
 */
export interface ChatConfig {
	/** Number of messages to fetch per page */
	pageSize?: number;
	/** Stream delta throttle in ms */
	streamThrottleMs?: number;
}

/**
 * Default chat configuration
 */
export const DEFAULT_CHAT_CONFIG: Required<ChatConfig> = {
	pageSize: 50,
	streamThrottleMs: 100
};

/**
 * File upload constraints
 *
 * `ALLOWED_FILE_EXT_MIME` is the single source of truth for what the chat
 * surface accepts. `ALLOWED_FILE_TYPES` (used by paste/MIME gate) and
 * `ALLOWED_FILE_EXTENSIONS` (used by the file-picker `accept` attribute
 * and the empty-`File.type` extension fallback in ChatInput) are derived
 * from it so adding/removing a format only needs one edit.
 */
export const ALLOWED_FILE_EXT_MIME: Readonly<Record<string, string>> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
	'.pdf': 'application/pdf',
	'.md': 'text/markdown',
	'.txt': 'text/plain'
};
export const ALLOWED_FILE_EXTENSIONS = Object.keys(ALLOWED_FILE_EXT_MIME).join(',');
export const ALLOWED_FILE_TYPES = Array.from(new Set(Object.values(ALLOWED_FILE_EXT_MIME)));
export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
export const MAX_FILE_SIZE_LABEL = '5MB';
/**
 * Absurdity ceiling for image inputs before client-side preprocessing.
 *
 * Distinct from MAX_FILE_SIZE: images always shrink through processImage
 * (resize to MAX_IMAGE_WIDTH + WebP encode), so the only reason to reject
 * large image inputs is to prevent OOM in createImageBitmap on low-memory
 * devices. 50MB matches roughly where iPhone Safari decode starts to fail.
 */
export const MAX_INPUT_IMAGE_SIZE = 50 * 1024 * 1024; // 50MB
export const MAX_INPUT_IMAGE_SIZE_LABEL = '50MB';
export const MAX_ATTACHMENTS = 6;
