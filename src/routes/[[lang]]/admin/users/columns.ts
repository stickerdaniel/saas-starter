import type { ColumnDef } from '@tanstack/table-core';
import { createRawSnippet } from 'svelte';
import { renderComponent, renderSnippet } from '$lib/components/ui/data-table/index.js';
import DataTableCheckbox from '$lib/components/data-table-checkbox.svelte';
import DataTableColumnHeader from './data-table-column-header.svelte';
import DataTableActions from './data-table-actions.svelte';
import type { AdminUserData } from '$lib/convex/admin/types';

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
	{
		id: 'select',
		size: 40,
		minSize: 40,
		maxSize: 40,
		header: ({ table }) =>
			renderComponent(DataTableCheckbox, {
				checked: table.getIsAllPageRowsSelected(),
				indeterminate: table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected(),
				onCheckedChange: (value) => table.toggleAllPageRowsSelected(!!value),
				'aria-label-key': 'admin.users.select_all'
			}),
		cell: ({ row }) =>
			renderComponent(DataTableCheckbox, {
				checked: row.getIsSelected(),
				onCheckedChange: (value) => row.toggleSelected(!!value),
				'aria-label-key': 'admin.users.select_row'
			}),
		enableSorting: false,
		enableHiding: false
	},
	{
		accessorKey: 'name',
		accessorFn: (row) => row.name ?? '',
		size: 180,
		minSize: 180,
		header: ({ column }) =>
			renderComponent(DataTableColumnHeader, {
				column,
				titleKey: 'admin.users.name'
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
	},
	{
		accessorKey: 'email',
		size: 250,
		minSize: 200,
		header: ({ column }) =>
			renderComponent(DataTableColumnHeader, {
				column,
				titleKey: 'admin.users.email'
			}),
		cell: ({ row }) => {
			const emailSnippet = createRawSnippet<[{ email: string }]>((getData) => {
				const { email } = getData();
				return {
					render: () => `<div>${email}</div>`
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
	},
	{
		accessorKey: 'role',
		size: 80,
		minSize: 80,
		header: ({ column }) =>
			renderComponent(DataTableColumnHeader, {
				column,
				titleKey: 'admin.users.role'
			}),
		cell: ({ row }) => {
			const roleSnippet = createRawSnippet<[{ role: string }]>((getData) => {
				const { role } = getData();
				const variant = role === 'admin' ? 'default' : 'secondary';
				return {
					render: () =>
						`<span class="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${
							variant === 'default'
								? 'bg-primary text-primary-foreground ring-primary/20'
								: 'bg-secondary text-secondary-foreground ring-secondary/20'
						}">${role}</span>`
				};
			});
			return renderSnippet(roleSnippet, { role: row.original.role });
		},
		filterFn: (row, _columnId, filterValue) => {
			if (!filterValue || filterValue === 'all') return true;
			return row.original.role === filterValue;
		}
	},
	{
		id: 'status',
		accessorFn: (row) => getStatusSortValue(row),
		size: 100,
		minSize: 100,
		header: ({ column }) =>
			renderComponent(DataTableColumnHeader, {
				column,
				titleKey: 'admin.users.status'
			}),
		cell: ({ row }) => {
			const statusSnippet = createRawSnippet<[{ banned: boolean; emailVerified?: boolean }]>(
				(getData) => {
					const { banned, emailVerified } = getData();
					if (banned) {
						return {
							render: () =>
								`<span class="inline-flex items-center rounded-md bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground ring-1 ring-inset ring-destructive/20">Banned</span>`
						};
					}
					if (emailVerified) {
						return {
							render: () =>
								`<span class="inline-flex items-center rounded-md border border-green-600 px-2 py-1 text-xs font-medium text-green-600 ring-1 ring-inset ring-green-600/20">Verified</span>`
						};
					}
					return {
						render: () =>
							`<span class="inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground ring-1 ring-inset ring-border">Unverified</span>`
					};
				}
			);
			return renderSnippet(statusSnippet, {
				banned: row.original.banned,
				emailVerified: row.original.emailVerified
			});
		},
		filterFn: (row, _columnId, filterValue) => {
			if (!filterValue || filterValue === 'all') return true;
			const user = row.original;
			if (filterValue === 'banned') return user.banned;
			if (filterValue === 'verified') return !user.banned && user.emailVerified === true;
			if (filterValue === 'unverified') return !user.banned && !user.emailVerified;
			return true;
		}
	},
	{
		accessorKey: 'createdAt',
		size: 110,
		minSize: 110,
		header: ({ column }) =>
			renderComponent(DataTableColumnHeader, {
				column,
				titleKey: 'admin.users.created'
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
	},
	{
		id: 'actions',
		size: 50,
		minSize: 50,
		maxSize: 50,
		enableHiding: false,
		enableSorting: false,
		header: () => {
			const headerSnippet = createRawSnippet(() => ({
				render: () => `<span class="sr-only">Actions</span>`
			}));
			return renderSnippet(headerSnippet, {});
		},
		cell: ({ row }) => renderComponent(DataTableActions, { user: row.original })
	}
];
