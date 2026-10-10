<script lang="ts" module>
	// Shares of the cell a text bar fills, cycled by row and offset by column so
	// neighbouring bars differ. Fixed rather than random, so the server and the
	// browser render the same widths.
	const TEXT_SHARES = ['52%', '41%', '58%', '46%', '55%', '43%', '50%'] as const;
</script>

<script lang="ts">
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import type { DataTableSkeleton } from './skeleton.ts';

	let {
		skeleton = { kind: 'text' },
		rowIndex,
		columnIndex
	}: { skeleton?: DataTableSkeleton; rowIndex: number; columnIndex: number } = $props();

	const barWidth = $derived(
		(skeleton.kind === 'text' && skeleton.width) ||
			TEXT_SHARES[(rowIndex + columnIndex * 3) % TEXT_SHARES.length]
	);
</script>

<!-- Each branch keeps the height of the real cell: a 20px text line, a 20px badge,
     the 16px checkbox, a 20px provider icon, the 32px avatar, and the 36px or 32px
     icon button. The surrounding row is aria-hidden. -->
{#if skeleton.kind === 'cell'}
	{@const config = skeleton.render()}
	<config.component {...config.props} />
{:else if skeleton.kind === 'checkbox'}
	<!-- A real checkbox keeps the cell's checkbox padding rule and the loaded look. -->
	<div class="flex items-center justify-center">
		<Checkbox disabled tabindex={-1} />
	</div>
{:else if skeleton.kind === 'badge'}
	<Skeleton class="h-5 w-14 rounded-4xl" />
{:else if skeleton.kind === 'icon'}
	<Skeleton class="size-5" />
{:else if skeleton.kind === 'avatar'}
	<div class="flex items-center gap-2">
		<Skeleton class="size-8 shrink-0 rounded-full" />
		<div class="min-w-0 flex-1">
			<Skeleton class="h-4 w-(--bar-width)" style="--bar-width: {barWidth}" />
		</div>
	</div>
{:else if skeleton.kind === 'action'}
	<div class={['flex items-center justify-center', skeleton.size === 'icon' ? 'size-9' : 'size-8']}>
		<Skeleton class="size-4" />
	</div>
{:else}
	<div class="flex h-5 items-center">
		<Skeleton class="h-4 w-(--bar-width)" style="--bar-width: {barWidth}" />
	</div>
{/if}
