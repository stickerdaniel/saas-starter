// Pagination defaults for support admin queries
export const SUPPORT_THREADS_PAGE_SIZE = 25;
export const INTERNAL_NOTES_PAGE_SIZE = 50;
export const ADMIN_USERS_BATCH_SIZE = 100;
// Per-message routes read for one thread. A support conversation never reaches
// this, and the read is newest-first, so a thread that somehow did keeps the
// routes an admin is looking at.
export const SUPPORT_MESSAGE_ROUTES_LIMIT = 500;

// UI configuration
export const INTERNAL_NOTE_TEXTAREA_ROWS = 3;
