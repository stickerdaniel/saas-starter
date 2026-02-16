import type { OptimisticLocalStore } from 'convex/browser';
import type { FunctionReference } from 'convex/server';

type AnyListQuery = FunctionReference<'query'>;

type ListQueryValue = {
	items: Array<Record<string, unknown>>;
};

function isListQueryValue(value: unknown): value is ListQueryValue {
	return Boolean(
		value &&
		typeof value === 'object' &&
		'items' in value &&
		Array.isArray((value as ListQueryValue).items)
	);
}

export function createOptimisticDelete(listQuery: AnyListQuery, id: string) {
	return (store: OptimisticLocalStore) => {
		const queries = store.getAllQueries(listQuery);
		for (const { args, value } of queries) {
			if (!isListQueryValue(value)) continue;
			const nextItems = value.items.map((item) =>
				String(item._id) === id ? { ...item, deletedAt: Date.now() } : item
			);
			store.setQuery(listQuery, args, {
				...value,
				items: nextItems
			});
		}
	};
}

export function createOptimisticDeleteMany(listQuery: AnyListQuery, ids: string[]) {
	const idSet = new Set(ids);
	return (store: OptimisticLocalStore) => {
		const queries = store.getAllQueries(listQuery);
		for (const { args, value } of queries) {
			if (!isListQueryValue(value)) continue;
			const nextItems = value.items.map((item) =>
				idSet.has(String(item._id)) ? { ...item, deletedAt: Date.now() } : item
			);
			store.setQuery(listQuery, args, {
				...value,
				items: nextItems
			});
		}
	};
}

export function createOptimisticRestore(listQuery: AnyListQuery, id: string) {
	return (store: OptimisticLocalStore) => {
		const queries = store.getAllQueries(listQuery);
		for (const { args, value } of queries) {
			if (!isListQueryValue(value)) continue;
			const nextItems = value.items.map((item) => {
				if (String(item._id) !== id) return item;
				const { deletedAt: _deletedAt, ...rest } = item;
				void _deletedAt;
				return rest;
			});
			store.setQuery(listQuery, args, {
				...value,
				items: nextItems
			});
		}
	};
}

export function createOptimisticRestoreMany(listQuery: AnyListQuery, ids: string[]) {
	const idSet = new Set(ids);
	return (store: OptimisticLocalStore) => {
		const queries = store.getAllQueries(listQuery);
		for (const { args, value } of queries) {
			if (!isListQueryValue(value)) continue;
			const nextItems = value.items.map((item) => {
				if (!idSet.has(String(item._id))) return item;
				const { deletedAt: _deletedAt, ...rest } = item;
				void _deletedAt;
				return rest;
			});
			store.setQuery(listQuery, args, {
				...value,
				items: nextItems
			});
		}
	};
}

export function createOptimisticForceDelete(listQuery: AnyListQuery, id: string) {
	return (store: OptimisticLocalStore) => {
		const queries = store.getAllQueries(listQuery);
		for (const { args, value } of queries) {
			if (!isListQueryValue(value)) continue;
			store.setQuery(listQuery, args, {
				...value,
				items: value.items.filter((item) => String(item._id) !== id)
			});
		}
	};
}

export function createOptimisticForceDeleteMany(listQuery: AnyListQuery, ids: string[]) {
	const idSet = new Set(ids);
	return (store: OptimisticLocalStore) => {
		const queries = store.getAllQueries(listQuery);
		for (const { args, value } of queries) {
			if (!isListQueryValue(value)) continue;
			store.setQuery(listQuery, args, {
				...value,
				items: value.items.filter((item) => !idSet.has(String(item._id)))
			});
		}
	};
}
