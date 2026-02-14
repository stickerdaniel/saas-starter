import type { ColumnDef } from '@tanstack/table-core';
import { createRawSnippet } from 'svelte';
import { renderComponent, renderSnippet } from '$lib/components/ui/data-table/index.js';
import type { NotificationRecipient } from '$lib/convex/admin/notificationPreferences/queries';
import DataTableCheckbox from '$lib/components/data-table-checkbox.svelte';
import DataTableColumnHeader from './data-table-column-header.svelte';
import RecipientsActions from './recipients-actions.svelte';
import RecipientsToggle from './recipients-toggle.svelte';
import TypeBadge from './type-badge.svelte';

export const columns: ColumnDef<NotificationRecipient>[] = [
	// Temporary checkbox column for layout testing
	{
		id: 'select',
		size: 40,
		minSize: 40,
		maxSize: 40,
		header: ({ table }) =>
			renderComponent(DataTableCheckbox, {
				checked: table.getIsAllPageRowsSelected(),
				indeterminate: table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected(),
				onCheckedChange: (value: boolean) => table.toggleAllPageRowsSelected(!!value),
				'aria-label-key': 'admin.users.select_all'
			}),
		cell: ({ row }) =>
			renderComponent(DataTableCheckbox, {
				checked: row.getIsSelected(),
				onCheckedChange: (value: boolean) => row.toggleSelected(!!value),
				'aria-label-key': 'admin.users.select_row'
			}),
		enableSorting: false,
		enableHiding: false
	},
	{
		accessorKey: 'email',
		size: 250,
		minSize: 200,
		header: ({ column }) =>
			renderComponent(DataTableColumnHeader, {
				column,
				titleKey: 'admin.settings.column_email',
				testId: 'admin-settings-sort-email'
			}),
		cell: ({ row }) => {
			const emailSnippet = createRawSnippet<[{ email: string }]>((getData) => {
				const { email } = getData();
				return {
					render: () => `<div class="font-medium">${email}</div>`
				};
			});
			return renderSnippet(emailSnippet, { email: row.original.email });
		}
	},
	{
		accessorKey: 'name',
		accessorFn: (row) => row.name ?? '',
		size: 150,
		minSize: 120,
		header: ({ column }) =>
			renderComponent(DataTableColumnHeader, {
				column,
				titleKey: 'admin.settings.column_name',
				testId: 'admin-settings-sort-name'
			}),
		cell: ({ row }) => {
			const nameSnippet = createRawSnippet<[{ name?: string }]>((getData) => {
				const { name } = getData();
				return {
					render: () =>
						`<div class="text-muted-foreground">${name || '<span class="text-muted-foreground/50">-</span>'}</div>`
				};
			});
			return renderSnippet(nameSnippet, { name: row.original.name });
		}
	},
	{
		id: 'type',
		accessorFn: (row) => (row.isAdminUser ? 0 : 1),
		size: 100,
		minSize: 80,
		header: ({ column }) =>
			renderComponent(DataTableColumnHeader, {
				column,
				titleKey: 'admin.settings.column_type',
				testId: 'admin-settings-sort-type'
			}),
		cell: ({ row }) =>
			renderComponent(TypeBadge, {
				isAdmin: row.original.isAdminUser
			}),
		enableSorting: true
	},
	{
		id: 'notifyNewSupportTickets',
		size: 100,
		minSize: 100,
		header: () =>
			renderComponent(DataTableColumnHeader, {
				titleKey: 'admin.settings.column_new_tickets',
				class: 'text-center'
			}),
		cell: ({ row }) =>
			renderComponent(RecipientsToggle, {
				email: row.original.email,
				field: 'notifyNewSupportTickets',
				checked: row.original.notifyNewSupportTickets
			})
	},
	{
		id: 'notifyUserReplies',
		size: 100,
		minSize: 100,
		header: () =>
			renderComponent(DataTableColumnHeader, {
				titleKey: 'admin.settings.column_user_replies',
				class: 'text-center'
			}),
		cell: ({ row }) =>
			renderComponent(RecipientsToggle, {
				email: row.original.email,
				field: 'notifyUserReplies',
				checked: row.original.notifyUserReplies
			})
	},
	{
		id: 'notifyNewSignups',
		size: 100,
		minSize: 100,
		header: () =>
			renderComponent(DataTableColumnHeader, {
				titleKey: 'admin.settings.column_new_signups',
				class: 'text-center'
			}),
		cell: ({ row }) =>
			renderComponent(RecipientsToggle, {
				email: row.original.email,
				field: 'notifyNewSignups',
				checked: row.original.notifyNewSignups
			})
	},
	{
		id: 'actions',
		size: 50,
		minSize: 50,
		maxSize: 50,
		enableHiding: false,
		header: () =>
			renderComponent(DataTableColumnHeader, {
				titleKey: 'aria.actions',
				class: 'sr-only'
			}),
		cell: ({ row }) =>
			renderComponent(RecipientsActions, {
				email: row.original.email,
				isAdminUser: row.original.isAdminUser
			})
	}
];
