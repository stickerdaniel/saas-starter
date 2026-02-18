import type { ColumnDef } from '@tanstack/table-core';
import { createRawSnippet } from 'svelte';
import { renderComponent, renderSnippet } from '$lib/components/ui/data-table/index.js';
import DataTableCheckbox from '$lib/components/data-table-checkbox.svelte';
import DataTableColumnHeader from './data-table-column-header.svelte';
import DataTableActions from './data-table-actions.svelte';
import type { AdminUserData } from '$lib/convex/admin/types';
import StatusBadge from './status-badge.svelte';
import RoleBadge from './role-badge.svelte';
import { applyColumnLayoutPreset, COLUMN_LAYOUT_PRESETS } from '$lib/tables/core/layout-presets';

/**
 * Derive a sortable status value from user data.
 * Priority: banned (highest) > unverified > verified (lowest)
 */
function getStatusSortValue(user: AdminUserData): number {
	if (user.banned) return 2;
	if (!user.emailVerified) return 1;
	return 0;
}

export const columns: ColumnDef<AdminUserData>[] = [
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
		preset: COLUMN_LAYOUT_PRESETS.avatarText,
		column: {
			accessorKey: 'name',
			accessorFn: (row) => row.name ?? '',
			header: ({ column }) =>
				renderComponent(DataTableColumnHeader, {
					column,
					titleKey: 'admin.users.name',
					testId: 'admin-users-sort-name'
				}),
			cell: ({ row }) => {
				const nameSnippet = createRawSnippet<[{ name?: string; image?: string | null }]>(
					(getData) => {
						const { name, image } = getData();
						const displayName = name || 'Unnamed';
						const avatarHtml = image
							? `<img src="${image}" alt="${displayName}" class="size-8 rounded-full" />`
							: `<div class="flex size-8 items-center justify-center rounded-full bg-muted">
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
							</div>`;
						return {
							render: () =>
								`<div class="flex items-center gap-2">${avatarHtml}<span class="font-medium">${displayName}</span></div>`
						};
					}
				);
				return renderSnippet(nameSnippet, {
					name: row.original.name,
					image: row.original.image
				});
			}
		}
	}),
	applyColumnLayoutPreset({
		preset: COLUMN_LAYOUT_PRESETS.email,
		column: {
			accessorKey: 'email',
			header: ({ column }) =>
				renderComponent(DataTableColumnHeader, {
					column,
					titleKey: 'admin.users.email',
					testId: 'admin-users-sort-email'
				}),
			cell: ({ row }) => {
				const emailSnippet = createRawSnippet<[{ email: string }]>((getData) => {
					const { email } = getData();
					return {
						render: () => `<div data-testid="admin-users-email-cell">${email}</div>`
					};
				});
				return renderSnippet(emailSnippet, { email: row.original.email });
			},
			filterFn: (row, _columnId, filterValue) => {
				const email = row.original.email.toLowerCase();
				const name = (row.original.name ?? '').toLowerCase();
				const search = (filterValue as string).toLowerCase();
				return email.includes(search) || name.includes(search);
			}
		}
	}),
	applyColumnLayoutPreset({
		preset: COLUMN_LAYOUT_PRESETS.badgeSm,
		overrides: {
			size: 80,
			minSize: 80,
			meta: {
				skeleton: {
					widthClass: 'w-12'
				}
			}
		},
		column: {
			accessorKey: 'role',
			header: ({ column }) =>
				renderComponent(DataTableColumnHeader, {
					column,
					titleKey: 'admin.users.role',
					testId: 'admin-users-sort-role'
				}),
			cell: ({ row }) =>
				renderComponent(RoleBadge, {
					role: row.original.role,
					testId: 'admin-users-role-badge'
				}),
			filterFn: (row, _columnId, filterValue: string) => {
				if (!filterValue || filterValue === 'all') return true;
				return row.original.role === filterValue;
			},
			enableSorting: true
		}
	}),
	applyColumnLayoutPreset({
		preset: COLUMN_LAYOUT_PRESETS.badgeMd,
		overrides: {
			size: 100,
			minSize: 100,
			meta: {
				skeleton: {
					widthClass: 'w-[65px]'
				}
			}
		},
		column: {
			id: 'status',
			accessorFn: (row) => getStatusSortValue(row),
			header: ({ column }) =>
				renderComponent(DataTableColumnHeader, {
					column,
					titleKey: 'admin.users.status'
				}),
			cell: ({ row }) =>
				renderComponent(StatusBadge, {
					banned: row.original.banned,
					emailVerified: row.original.emailVerified,
					testId: 'admin-users-status-badge'
				}),
			filterFn: (row, _columnId, filterValue: string) => {
				if (!filterValue || filterValue === 'all') return true;
				const user = row.original;
				if (filterValue === 'banned') return user.banned;
				if (filterValue === 'verified') return !user.banned && user.emailVerified === true;
				if (filterValue === 'unverified') return !user.banned && !user.emailVerified;
				return true;
			},
			enableSorting: false
		}
	}),
	applyColumnLayoutPreset({
		preset: COLUMN_LAYOUT_PRESETS.date,
		overrides: {
			size: 110,
			minSize: 110
		},
		column: {
			accessorKey: 'createdAt',
			header: ({ column }) =>
				renderComponent(DataTableColumnHeader, {
					column,
					titleKey: 'admin.users.created',
					testId: 'admin-users-sort-created'
				}),
			cell: ({ row }) => {
				const dateSnippet = createRawSnippet<[{ createdAt?: number }]>((getData) => {
					const { createdAt } = getData();
					const formatted = createdAt ? new Date(createdAt).toLocaleDateString() : '-';
					return {
						render: () => `<div>${formatted}</div>`
					};
				});
				return renderSnippet(dateSnippet, { createdAt: row.original.createdAt });
			}
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
			cell: ({ row }) => renderComponent(DataTableActions, { user: row.original })
		}
	})
];
