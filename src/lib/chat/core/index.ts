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
	StreamStatus,
	SendMessageOptions,
	SendMessageResult,
	ChatConfig,
	CreateThreadOptions
} from './types.js';

export type { ChatSessionPort, StreamCachePort } from './chat-session-port.js';
export type { ChatCommandErrorCode } from './chat-command-error.js';

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
export type { UploadErrorCode } from '../../uploads/transfer.js';

export { uploadFileWithProgress } from './file-uploader.js';
export { uploadToStorage, UploadError } from '../../uploads/transfer.js';

// Chat core
export type {
	ChatCoreAPI,
	ChatCoreOptions,
	ChatCoreErrorCode,
	CreateThreadResult
} from './chat-core.svelte.ts';

export { ChatCore, createChatCore } from './chat-core.svelte.ts';
export { ChatCommandError } from './chat-command-error.js';

// Composer persistence
export { ChatDraftManager } from './chat-draft-manager.svelte.ts';
export type { ChatDraftCheckpoint } from './chat-draft-manager.svelte.ts';
export { ChatAttachmentStore } from './chat-attachment-store.svelte.ts';
export type { AttachmentsByThread } from './chat-attachment-store.svelte.ts';
export { clearPersistedChatState } from './chat-persisted-state.ts';
