<script lang="ts">
	import { cn } from '$lib/utils';

	interface Props {
		title: string;
		description: string;
		class?: string;
	}

	let { title, description, class: className }: Props = $props();
</script>

<div class={cn('flex flex-col gap-2', className)}>
	<h1 class="text-lg font-semibold md:text-2xl">{title}</h1>
	<p class="text-sm text-muted-foreground">
		{description}
	</p>
</div>
