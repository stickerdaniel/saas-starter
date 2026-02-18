import { PersistedState } from 'runed';

export const adminCache = {
	supportThreadCounts: new PersistedState<Record<string, number>>(
		'admin-cache:supportThreadCounts',
		{}
	)
};
