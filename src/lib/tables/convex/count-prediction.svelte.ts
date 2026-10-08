import type { PersistedState } from 'runed';
import { clamp } from '#lib/utils/math.js';
import type { ConvexCursorTableState } from './create-convex-cursor-table.svelte.ts';

type CountedTable = Pick<
	ConvexCursorTableState<unknown, string, string>,
	'totalCount' | 'hasLoadedCount' | 'isUnfiltered' | 'pageIndex' | 'pageSize'
>;

/**
 * Predict a cursor table's row count before its count query resolves, from a
 * count persisted on an earlier visit.
 *
 * Only the unfiltered count is stored and read: a filtered count says nothing
 * about the next visit, which opens unfiltered. A cached zero predicts an empty
 * first page on purpose, so an empty table shows its empty state immediately.
 */
export function createCountPrediction({
	table,
	cache
}: {
	table: CountedTable;
	cache: PersistedState<number | null>;
}) {
	// The cache lives in storage, outside Svelte, so an effect writes it.
	$effect(() => {
		if (table.hasLoadedCount && table.isUnfiltered) {
			cache.current = table.totalCount;
		}
	});

	const cached = $derived(table.isUnfiltered ? cache.current : null);
	const skeletonRows = $derived(
		cached === null
			? table.pageSize
			: clamp(cached - table.pageIndex * table.pageSize, 0, table.pageSize)
	);
	const total = $derived(table.hasLoadedCount ? table.totalCount : (cached ?? 0));

	return {
		/** Skeleton rows to render while the current page loads. */
		get skeletonRows() {
			return skeletonRows;
		},
		/** The loaded total, else the cached unfiltered total, else 0. */
		get total() {
			return total;
		}
	};
}
