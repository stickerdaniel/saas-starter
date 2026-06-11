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
	CHAT_PAGE_SIZE,
	DEFAULT_CHAT_CONFIG,
	ALLOWED_FILE_EXT_MIME,
	ALLOWED_FILE_TYPES,
	ALLOWED_FILE_EXTENSIONS,
	MAX_FILE_SIZE,
	MAX_FILE_SIZE_LABEL,
	MAX_INPUT_IMAGE_SIZE,
	MAX_INPUT_IMAGE_SIZE_LABEL
} from './types.js';

// Stream processing (public API)
export {
	extractReasoning,
	extractUserMessageText,
	normalizeMessage
} from './message-extraction.js';

export {
	blankUIMessage,
	statusFromStreamStatus,
	deriveUIMessagesFromTextStreamParts,
	deriveUIMessagesFromDeltas,
	combineStreamingUIMessages
} from './stream-materialization.js';

export { StreamCacheManager } from './stream-cache.js';

// File upload
export type { UploadResult, ProgressCallback } from './file-uploader.js';

export {
	uploadFileWithProgress,
	createUploadState,
	createSuccessState,
	createErrorState,
	updateProgress,
	FileUploadManager
} from './file-uploader.js';

// Chat core
export type { ChatCoreAPI, ChatCoreOptions, CreateThreadResult } from './chat-core.svelte.js';

export { ChatCore, createChatCore } from './chat-core.svelte.js';

// Draft persistence
export { ChatDraftManager } from './chat-draft-manager.svelte.js';
