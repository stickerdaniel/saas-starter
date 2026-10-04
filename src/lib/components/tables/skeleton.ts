import type { renderComponent } from '@tanstack/svelte-table';

/**
 * What a column shows while its table loads. Each kind keeps the box height of the
 * cell it stands in for, so rows keep their height when the data arrives; bar widths
 * are cosmetic. A column without one shows `text`. `cell` renders a component that
 * owns its own loading state, for cells whose height no simple kind reproduces.
 */
export type DataTableSkeleton =
	| { kind: 'text' | 'badge' | 'checkbox' | 'icon' | 'avatar' }
	| { kind: 'action'; size: 'icon' | 'icon-sm' }
	| { kind: 'cell'; render: () => ReturnType<typeof renderComponent> };
