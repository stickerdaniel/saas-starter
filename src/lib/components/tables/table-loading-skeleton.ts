import type { ColumnDef } from '@tanstack/table-core';

export type TableSkeletonCellKind =
	| 'checkbox'
	| 'avatarText'
	| 'text'
	| 'badge'
	| 'iconButton'
	| 'iconButtonGroup'
	| 'selectTrigger'
	| 'mutedDash'
	| 'empty';

export type TableSkeletonColumn = {
	key: string;
	kind?: TableSkeletonCellKind;
	widthClass?: string;
	cellClass?: string;
	checkboxAriaLabelKey?: string;
	iconCount?: number;
};

type TableSkeletonOverrides = Record<string, Partial<TableSkeletonColumn>>;

function getColumnKey(column: ColumnDef<unknown>, index: number): string {
	if ('id' in column && typeof column.id === 'string') {
		return column.id;
	}
	if ('accessorKey' in column && typeof column.accessorKey === 'string') {
		return column.accessorKey;
	}
	return `column-${index}`;
}

function getColumnMeta(column: ColumnDef<unknown>) {
	return (column.meta ?? {}) as {
		cellClass?: string;
		skeleton?: Partial<TableSkeletonColumn>;
	};
}

function inferColumnPreset(key: string): Omit<TableSkeletonColumn, 'key'> {
	const normalizedKey = key.toLowerCase();

	if (normalizedKey === 'select') {
		return {
			kind: 'checkbox',
			cellClass: '[&:has([role=checkbox])]:px-0'
		};
	}

	if (normalizedKey === 'actions') {
		return {
			kind: 'iconButton'
		};
	}

	if (normalizedKey.startsWith('notify')) {
		return {
			kind: 'checkbox',
			cellClass: '[&:has([role=checkbox])]:px-0'
		};
	}

	if (normalizedKey === 'name') {
		return {
			kind: 'text',
			widthClass: 'w-24'
		};
	}

	if (normalizedKey.includes('email')) {
		return {
			kind: 'text',
			widthClass: 'w-40'
		};
	}

	if (normalizedKey === 'role' || normalizedKey === 'status' || normalizedKey === 'type') {
		return {
			kind: 'badge',
			widthClass: 'w-14'
		};
	}

	if (normalizedKey.includes('date') || normalizedKey.includes('created')) {
		return {
			kind: 'text',
			widthClass: 'w-20'
		};
	}

	return {
		kind: 'text',
		widthClass: 'w-24'
	};
}

export function inferTableSkeletonColumns<TData>(
	columns: ColumnDef<TData>[],
	overrides: TableSkeletonOverrides = {}
): TableSkeletonColumn[] {
	return getTableSkeletonColumnsFromColumnDefs(columns, overrides);
}

export function getTableSkeletonColumnsFromColumnDefs<TData>(
	columns: ColumnDef<TData>[],
	overrides: TableSkeletonOverrides = {}
): TableSkeletonColumn[] {
	return columns.map((column, index) => {
		const unknownColumn = column as ColumnDef<unknown>;
		const key = getColumnKey(unknownColumn, index);
		const inferred = inferColumnPreset(key);
		const meta = getColumnMeta(unknownColumn);

		return {
			key,
			...inferred,
			...(meta.skeleton ?? {}),
			...(meta.cellClass ? { cellClass: meta.cellClass } : {}),
			...overrides[key]
		};
	});
}
