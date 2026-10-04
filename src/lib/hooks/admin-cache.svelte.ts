import { PersistedState } from 'runed';

// The v2 count keys hold only unfiltered counts; the v1 keys could hold a filtered count.
export const adminCache = {
	userCount: new PersistedState<number | null>('admin-cache:v2:userCount', null),
	auditLogCount: new PersistedState<number | null>('admin-cache:v2:auditLogCount', null),
	recipientCount: new PersistedState<number | null>('admin-cache:v2:recipientCount', null),
	supportThreadCounts: new PersistedState<Record<string, number>>(
		'admin-cache:supportThreadCounts',
		{}
	)
};
