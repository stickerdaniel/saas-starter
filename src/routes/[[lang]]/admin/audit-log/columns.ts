import type { ColumnDef } from '@tanstack/table-core';
import { createRawSnippet } from 'svelte';
import { renderComponent, renderSnippet } from '$lib/components/ui/data-table/index.js';
import DataTableColumnHeader from './data-table-column-header.svelte';
import EventBadge from './event-badge.svelte';

/**
 * Shape of an audit log row returned from the backend query.
 */
export interface AuditLogRow {
	_id: string;
	adminUserId: string;
	action: string;
	targetUserId: string;
	metadata?: { reason?: string; newRole?: string; previousRole?: string } | Record<string, never>;
	timestamp: number;
	// Resolved display fields (populated by the page)
	adminEmail?: string;
	targetEmail?: string;
}

export const columns: ColumnDef<AuditLogRow>[] = [
	{
		accessorKey: 'timestamp',
		size: 160,
		minSize: 140,
		header: ({ column }) =>
			renderComponent(DataTableColumnHeader, {
				column,
				titleKey: 'admin.audit_log.column.timestamp',
				testId: 'audit-log-sort-timestamp'
			}),
		cell: ({ row }) => {
			const dateSnippet = createRawSnippet<[{ timestamp: number }]>((getData) => {
				const { timestamp } = getData();
				const date = new Date(timestamp);
				const formatted = date.toLocaleString();
				return {
					render: () =>
						`<div class="text-sm text-muted-foreground" data-testid="audit-log-timestamp-cell">${formatted}</div>`
				};
			});
			return renderSnippet(dateSnippet, { timestamp: row.original.timestamp });
		},
		sortingFn: (a, b) => a.original.timestamp - b.original.timestamp
	},
	{
		accessorKey: 'action',
		size: 140,
		minSize: 120,
		header: () =>
			renderComponent(DataTableColumnHeader, {
				titleKey: 'admin.audit_log.column.event'
			}),
		cell: ({ row }) =>
			renderComponent(EventBadge, {
				action: row.original.action,
				testId: 'audit-log-event-badge'
			}),
		enableSorting: false
	},
	{
		accessorKey: 'adminEmail',
		size: 200,
		minSize: 160,
		header: () =>
			renderComponent(DataTableColumnHeader, {
				titleKey: 'admin.audit_log.column.admin'
			}),
		cell: ({ row }) => {
			const emailSnippet = createRawSnippet<[{ email: string }]>((getData) => {
				const { email } = getData();
				return {
					render: () => `<div class="text-sm" data-testid="audit-log-admin-cell">${email}</div>`
				};
			});
			return renderSnippet(emailSnippet, {
				email: row.original.adminEmail ?? row.original.adminUserId
			});
		},
		enableSorting: false
	},
	{
		accessorKey: 'targetEmail',
		size: 200,
		minSize: 160,
		header: () =>
			renderComponent(DataTableColumnHeader, {
				titleKey: 'admin.audit_log.column.target_user'
			}),
		cell: ({ row }) => {
			const emailSnippet = createRawSnippet<[{ email: string }]>((getData) => {
				const { email } = getData();
				return {
					render: () => `<div class="text-sm" data-testid="audit-log-target-cell">${email}</div>`
				};
			});
			return renderSnippet(emailSnippet, {
				email: row.original.targetEmail ?? row.original.targetUserId
			});
		},
		enableSorting: false
	},
	{
		id: 'details',
		size: 200,
		minSize: 120,
		header: () =>
			renderComponent(DataTableColumnHeader, {
				titleKey: 'admin.audit_log.column.details'
			}),
		cell: ({ row }) => {
			const detailsSnippet = createRawSnippet<
				[{ metadata: AuditLogRow['metadata']; action: string }]
			>((getData) => {
				const { metadata, action } = getData();
				let detail = '';
				if (metadata && 'reason' in metadata && metadata.reason) {
					detail = metadata.reason;
				} else if (metadata && 'newRole' in metadata && metadata.newRole && metadata.previousRole) {
					detail = `${metadata.previousRole} → ${metadata.newRole}`;
				} else if (action === 'impersonate' || action === 'stop_impersonation') {
					detail = '—';
				} else {
					detail = '—';
				}
				return {
					render: () =>
						`<div class="text-sm text-muted-foreground" data-testid="audit-log-details-cell">${detail}</div>`
				};
			});
			return renderSnippet(detailsSnippet, {
				metadata: row.original.metadata,
				action: row.original.action
			});
		},
		enableSorting: false
	}
];
