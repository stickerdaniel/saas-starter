import type { ColumnDef } from '@tanstack/table-core';
import { createRawSnippet } from 'svelte';
import { renderComponent, renderSnippet } from '$lib/components/ui/data-table/index.js';
import type { NotificationRecipient } from '$lib/convex/admin/notificationPreferences/queries';
import DataTableCheckbox from '$lib/components/data-table-checkbox.svelte';
import DataTableColumnHeader from './data-table-column-header.svelte';
import RecipientsActions from './recipients-actions.svelte';
import RecipientsToggle from './recipients-toggle.svelte';
import TypeBadge from './type-badge.svelte';
import { applyColumnLayoutPreset, COLUMN_LAYOUT_PRESETS } from '$lib/tables/core/layout-presets';

export const columns: ColumnDef<NotificationRecipient>[] = [
	applyColumnLayoutPreset({
		preset: COLUMN_LAYOUT_PRESETS.selectCheckbox,
		column: {
			id: 'select',
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
		}
	}),
	applyColumnLayoutPreset({
		preset: COLUMN_LAYOUT_PRESETS.email,
		column: {
			accessorKey: 'email',
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
		}
	}),
	applyColumnLayoutPreset({
		preset: COLUMN_LAYOUT_PRESETS.textMd,
		overrides: {
			size: 150,
			minSize: 120
		},
		column: {
			accessorKey: 'name',
			accessorFn: (row) => row.name ?? '',
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
		}
	}),
	applyColumnLayoutPreset({
		preset: COLUMN_LAYOUT_PRESETS.badgeSm,
		overrides: {
			size: 100,
			minSize: 80
		},
		column: {
			id: 'type',
			accessorFn: (row) => (row.isAdminUser ? 0 : 1),
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
		}
	}),
	applyColumnLayoutPreset({
		preset: COLUMN_LAYOUT_PRESETS.inlineCheckbox,
		column: {
			id: 'notifyNewSupportTickets',
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
		}
	}),
	applyColumnLayoutPreset({
		preset: COLUMN_LAYOUT_PRESETS.inlineCheckbox,
		column: {
			id: 'notifyUserReplies',
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
		}
	}),
	applyColumnLayoutPreset({
		preset: COLUMN_LAYOUT_PRESETS.inlineCheckbox,
		column: {
			id: 'notifyNewSignups',
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
		}
	}),
	applyColumnLayoutPreset({
		preset: COLUMN_LAYOUT_PRESETS.actionsMenu,
		column: {
			id: 'actions',
			enableHiding: false,
			enableSorting: false,
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
	})
];
