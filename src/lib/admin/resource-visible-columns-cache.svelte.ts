import { PersistedState } from 'runed';

type VisibleColumnsCacheRecord = Record<string, string[]>;

export type VisibleColumnsIdentity = {
	viewerId?: string;
	search: string;
	filters: Record<string, string>;
};

export function serializeVisibleColumnsIdentity(identity: VisibleColumnsIdentity) {
	const filterEntries = Object.entries(identity.filters).sort(([a], [b]) => a.localeCompare(b));
	return JSON.stringify({
		viewerId: identity.viewerId ?? '',
		search: identity.search.trim(),
		filters: filterEntries
	});
}

export function createResourceVisibleColumnsCache(resourceName: string) {
	const state = new PersistedState<VisibleColumnsCacheRecord>(
		`admin-resource:visible-columns:${resourceName}`,
		{}
	);

	return {
		get(identityKey: string) {
			return state.current[identityKey];
		},
		set(identityKey: string, visibleColumns: string[]) {
			if (visibleColumns.length === 0) return;
			const existing = state.current[identityKey];
			const same =
				existing?.length === visibleColumns.length &&
				existing.every((value, index) => value === visibleColumns[index]);
			if (same) return;
			state.current = {
				...state.current,
				[identityKey]: visibleColumns
			};
		}
	};
}
