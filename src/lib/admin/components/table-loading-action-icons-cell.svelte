<script lang="ts">
	import { T } from '@tolgee/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';

	type Props = {
		iconCount?: number;
	};

	let { iconCount = 4 }: Props = $props();
</script>

<div class="flex justify-end gap-1">
	{#each Array.from({ length: iconCount }) as _icon, iconIndex (iconIndex)}
		<Button variant="ghost" size="icon" disabled data-no-row-click="true">
			<Skeleton class="size-4 rounded-sm" />
			<span class="sr-only"><T keyName="aria.loading" /></span>
		</Button>
	{/each}
</div>
