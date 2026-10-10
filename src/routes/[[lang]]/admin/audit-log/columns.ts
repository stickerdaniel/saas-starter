import type { ColumnDef } from '@tanstack/table-core';
import type { DataTableFeatures } from '#lib/components/ui/data-table/data-table.svelte.ts';
import type { DataTableSkeleton } from '#lib/components/tables/skeleton.ts';
import { renderComponent, renderTextCell } from '#lib/components/ui/data-table/index.js';
import DataTableColumnHeader from '#lib/components/admin/data-table-column-header.svelte';
import type { AuditLogItem } from '#lib/convex/admin/auditLog/queries.js';
import { DEFAULT_LANGUAGE } from '#lib/i18n/languages.js';
import ActionBadge from './action-badge.svelte';
import UserRefCell from './user-ref-cell.svelte';
import DetailsCell from './details-cell.svelte';

// The two-line reference sets the audit row height, so it renders its own skeleton.
const userRefSkeleton: DataTableSkeleton = {
	kind: 'cell',
	render: () => renderComponent(UserRefCell, {})
};

type CellFilterHandlers = {
	onFilterAdmin: (userId: string) => void;
	onFilterTarget: (userId: string) => void;
};

export function createColumns(
	lang: string,
	handlers: CellFilterHandlers
): Array<ColumnDef<DataTableFeatures, AuditLogItem>> {
	return [
		{
			accessorKey: 'timestamp',
			size: 170,
			minSize: 150,
			enableSorting: true,
			header: ({ column }) =>
				renderComponent(DataTableColumnHeader, {
					column,
					titleKey: 'admin.audit_log.column.time',
					testId: 'admin-audit-log-sort-time'
				}),
			cell: ({ row }) =>
				renderTextCell(new Date(row.original.timestamp).toLocaleString(lang || DEFAULT_LANGUAGE), {
					class: 'text-sm'
				}),
			// Timestamps share one format, so every row gets the same bar.
			meta: { skeleton: { kind: 'text', width: '75%' } }
		},
		{
			accessorKey: 'action',
			size: 150,
			minSize: 130,
			enableSorting: false,
			header: () =>
				renderComponent(DataTableColumnHeader, {
					titleKey: 'admin.audit_log.column.action'
				}),
			cell: ({ row }) =>
				renderComponent(ActionBadge, {
					action: row.original.action,
					testId: 'audit-log-action-badge'
				}),
			meta: { skeleton: { kind: 'badge' } }
		},
		{
			id: 'admin',
			size: 220,
			minSize: 180,
			enableSorting: false,
			header: () =>
				renderComponent(DataTableColumnHeader, {
					titleKey: 'admin.audit_log.column.admin'
				}),
			cell: ({ row }) =>
				renderComponent(UserRefCell, {
					user: row.original.admin,
					kind: 'admin',
					onFilter: () => handlers.onFilterAdmin(row.original.admin.id),
					testId: 'audit-log-admin-cell'
				}),
			meta: { skeleton: userRefSkeleton }
		},
		{
			id: 'target',
			size: 220,
			minSize: 180,
			enableSorting: false,
			header: () =>
				renderComponent(DataTableColumnHeader, {
					titleKey: 'admin.audit_log.column.target'
				}),
			cell: ({ row }) =>
				renderComponent(UserRefCell, {
					user: row.original.target,
					kind: 'target',
					onFilter: () => handlers.onFilterTarget(row.original.target.id),
					testId: 'audit-log-target-cell'
				}),
			meta: { skeleton: userRefSkeleton }
		},
		{
			id: 'details',
			size: 260,
			minSize: 200,
			enableSorting: false,
			header: () =>
				renderComponent(DataTableColumnHeader, {
					titleKey: 'admin.audit_log.column.details'
				}),
			cell: ({ row }) =>
				renderComponent(DetailsCell, {
					metadata: row.original.metadata,
					lang,
					testId: 'audit-log-details-cell'
				})
		}
	];
}
