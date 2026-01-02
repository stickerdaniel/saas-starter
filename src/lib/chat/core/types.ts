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
			name: string;
			size: number;
			mimeType: string;
			file?: File;
			preview?: string;
			url?: string;
			uploadState?: UploadState;
	  }
	| {
			type: 'screenshot';
			name: string;
			size: number;
			mimeType: string;
			blob?: Blob;
			preview?: string;
			url?: string;
			uploadState?: UploadState;
	  }
	| { type: 'image'; url: string; filename?: string }
	| { type: 'remote-file'; url: string; filename: string; contentType?: string };

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
	/** Stable key for {#each} - preserves DOM during optimistic→real transition */
	_renderKey?: string;
}

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
	type: string; // "tool-{toolName}" format
	toolCallId: string;
	input?: Record<string, unknown>; // Tool arguments
	state?: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
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
	reasoning: string;
	providerMetadata?: ProviderMetadata;
};

/**
 * Extended message part types
 */
export type MessagePart = TextUIPart | ReasoningUIPart | { type: string; [key: string]: unknown };

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
 * Options for sending a message
 */
export interface SendMessageOptions {
	fileIds?: string[];
	openWidgetAfter?: boolean;
	attachments?: Attachment[];
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
 */
export const ALLOWED_FILE_TYPES = [
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/gif',
	'application/pdf'
];
export const ALLOWED_FILE_EXTENSIONS = '.png,.jpg,.jpeg,.webp,.gif,.pdf';
export const MAX_FILE_SIZE = 3 * 1024 * 1024; // 3MB
export const MAX_FILE_SIZE_LABEL = '3MB';
export const MAX_ATTACHMENTS = 6;
