import { persisted } from '#lib/storage/persisted.svelte.ts';

// The v2 count keys hold only unfiltered counts; the v1 keys could hold a filtered count.
export const adminCache = {
	userCount: persisted<number | null>('admin-cache:v2:userCount', null),
	auditLogCount: persisted<number | null>('admin-cache:v2:auditLogCount', null),
	recipientCount: persisted<number | null>('admin-cache:v2:recipientCount', null),
	supportThreadCounts: persisted<Record<string, number>>('admin-cache:supportThreadCounts', {})
};
