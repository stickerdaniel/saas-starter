import type { RowSelectionState, Updater } from '@tanstack/table-core';

function keepRows(selection: RowSelectionState, rowIds: string[]): RowSelectionState {
	const current = new Set(rowIds);
	const ids = Object.keys(selection);
	if (ids.every((id) => current.has(id))) return selection;
	const kept: RowSelectionState = {};
	for (const id of ids) {
		if (current.has(id)) kept[id] = true;
	}
	return kept;
}

/**
 * Controlled TanStack row selection for server-paged tables, where the table
 * only ever holds the rows of the current page.
 *
 * The selection is the persistent intersection with the current rows: an id
 * that leaves the rows (page change, query change, deletion) is dropped for
 * good and does not return with its row, while an id that stays through a
 * sort or filter change stays selected.
 */
export function createRowSelection(getRowIds: () => string[]) {
	// Pruning has to narrow the stored selection rather than only the view of it,
	// so it is plain memory that the derived narrows on every evaluation. A
	// derived cannot write `$state`; `revision` makes caller writes reactive. The
	// table adapter reads `rowSelection` whenever its rows change, which keeps
	// the pruning in step with the rows.
	let selection: RowSelectionState = {};
	let revision = $state(0);

	const state = $derived.by(() => {
		void revision;
		selection = keepRows(selection, getRowIds());
		return selection;
	});
	const count = $derived(Object.keys(state).length);

	function onChange(updater: Updater<RowSelectionState>) {
		selection = typeof updater === 'function' ? updater(state) : updater;
		revision++;
	}

	return {
		get state() {
			return state;
		},
		get count() {
			return count;
		},
		onChange
	};
}
