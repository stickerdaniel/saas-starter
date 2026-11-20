import { allowedMimeTypes, UPLOAD_PROFILES } from '../uploads/profiles';

// Profile image upload constraints, derived from the profile the picker also
// reads, so the client cannot offer a type this file would reject.
export const PROFILE_IMAGE_MAX_SIZE = UPLOAD_PROFILES.profileImage.maxBytes;
export const PROFILE_IMAGE_MAX_SIZE_LABEL = UPLOAD_PROFILES.profileImage.maxBytesLabel;
export const PROFILE_IMAGE_ALLOWED_TYPES = allowedMimeTypes(UPLOAD_PROFILES.profileImage);

// Maximum characters allowed in a single chat message.
// Mirrors the client-side MAX_MESSAGE_LENGTH in src/lib/chat/core/types.ts.
export const MAX_MESSAGE_LENGTH = 2000;

// Sentinels stored under providerMetadata.system.notice on an AI chat notice
// that ends a turn: the usage gate denied it, or the generation failed. The UI
// maps each to localized copy instead of rendering the English fallback
// stored with the message.
export const AI_CHAT_LIMIT_NOTICE = 'ai_chat_limit_reached';
export const AI_CHAT_GENERATION_FAILED_NOTICE = 'ai_chat_generation_failed';
export type AiChatNotice = typeof AI_CHAT_LIMIT_NOTICE | typeof AI_CHAT_GENERATION_FAILED_NOTICE;
