/**
 * Chat Core - Headless chat library
 *
 * This module exports all core functionality for building AI chat interfaces.
 * The core is framework-agnostic and can be used with any UI implementation.
 */

// Types
export type {
	UploadState,
	Attachment,
	MessageStatus,
	MessageRole,
	ChatMessage,
	DisplayMessage,
	TextUIPart,
	ReasoningUIPart,
	MessagePart,
	PaginationState,
	StreamStatus,
	SendMessageOptions,
	SendMessageResult,
	ChatConfig,
	CreateThreadOptions
} from './types.js';

export {
	DEFAULT_CHAT_CONFIG,
	ALLOWED_FILE_TYPES,
	ALLOWED_FILE_EXTENSIONS,
	MAX_FILE_SIZE,
	MAX_FILE_SIZE_LABEL
} from './types.js';

// Stream processing (public API)
export {
	extractReasoning,
	extractUserMessageText,
	normalizeMessage,
	deriveUIMessagesFromTextStreamParts,
	StreamCacheManager
} from './StreamProcessor.js';

// File upload
export type { UploadResult, ProgressCallback } from './FileUploader.js';

export {
	uploadFileWithProgress,
	createUploadState,
	createSuccessState,
	createErrorState,
	updateProgress,
	FileUploadManager
} from './FileUploader.js';

// Chat core
export type { ChatCoreAPI, ChatCoreOptions, CreateThreadResult } from './ChatCore.svelte.js';

export { ChatCore, createChatCore } from './ChatCore.svelte.js';
