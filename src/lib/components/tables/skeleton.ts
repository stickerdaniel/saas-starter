import type { renderComponent } from '@tanstack/svelte-table';

/**
 * What a column shows while its table loads. Each kind keeps the box height of the
 * cell it stands in for, so rows keep their height when the data arrives. A column
 * without one shows `text`. `cell` renders a component that owns its own loading
 * state, for cells whose height no simple kind reproduces.
 *
 * Text bars vary by row around half the cell, a little shorter than typical text:
 * text that runs past its bar reads as arriving, a bar left partly uncovered reads
 * as missing content. `width` pins the bar for values of constant length, such as
 * formatted timestamps.
 */
export type DataTableSkeleton =
	| { kind: 'text'; width?: `${number}%` }
	| { kind: 'badge' | 'checkbox' | 'icon' | 'avatar' }
	| { kind: 'action'; size: 'icon' | 'icon-sm' }
	| { kind: 'cell'; render: () => ReturnType<typeof renderComponent> };
