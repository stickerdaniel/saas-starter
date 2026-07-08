import type { ColumnDef } from '@tanstack/table-core';
import { createRawSnippet } from 'svelte';
import { renderComponent, renderSnippet } from '$lib/components/ui/data-table/index.js';
import DataTableColumnHeader from '$lib/components/admin/data-table-column-header.svelte';
import type { AuditLogItem } from '$lib/convex/admin/auditLog/queries';
import { DEFAULT_LANGUAGE } from '$lib/i18n/languages';
import ActionBadge from './action-badge.svelte';
import UserRefCell from './user-ref-cell.svelte';
import DetailsCell from './details-cell.svelte';

export function createColumns(lang: string): Array<ColumnDef<AuditLogItem>> {
	return [
		{
			accessorKey: 'timestamp',
			size: 170,
			minSize: 150,
			enableSorting: false,
			header: () =>
				renderComponent(DataTableColumnHeader, {
					titleKey: 'admin.audit_log.column.time'
				}),
			cell: ({ row }) => {
				const timeSnippet = createRawSnippet<[{ timestamp: number }]>((getData) => {
					const { timestamp } = getData();
					const formatted = new Date(timestamp).toLocaleString(lang || DEFAULT_LANGUAGE);
					return {
						render: () => `<div class="whitespace-nowrap text-sm">${formatted}</div>`
					};
				});
				return renderSnippet(timeSnippet, { timestamp: row.original.timestamp });
			}
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
				})
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
					testId: 'audit-log-admin-cell'
				})
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
					testId: 'audit-log-target-cell'
				})
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
					testId: 'audit-log-details-cell'
				})
		}
	];
}
