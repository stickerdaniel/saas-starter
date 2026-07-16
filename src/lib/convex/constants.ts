// Profile image upload constraints
export const PROFILE_IMAGE_MAX_SIZE = 2 * 1024 * 1024; // 2MB
export const PROFILE_IMAGE_MAX_SIZE_LABEL = '2MB';
export const PROFILE_IMAGE_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// Maximum characters allowed in a single chat message.
// Mirrors the client-side MAX_MESSAGE_LENGTH in src/lib/chat/core/types.ts;
// Convex code cannot import client chat modules, so it is duplicated here.
export const MAX_MESSAGE_LENGTH = 2000;

// Sentinel stored under providerMetadata.system.notice when the AI chat
// usage gate denies a turn. The UI maps it to localized copy instead of
// rendering the English fallback stored with the message.
export const AI_CHAT_LIMIT_NOTICE = 'ai_chat_limit_reached';
