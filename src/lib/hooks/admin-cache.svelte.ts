import { PersistedState } from 'runed';

export const adminCache = {
	userCount: new PersistedState<number | null>('admin-cache:userCount', null),
	recipientCount: new PersistedState<number | null>('admin-cache:recipientCount', null),
	supportThreadCounts: new PersistedState<Record<string, number>>(
		'admin-cache:supportThreadCounts',
		{}
	)
};
