<script lang="ts">
	import { Avatar, AvatarFallback } from '$lib/components/ui/avatar';
	import type { Component } from 'svelte';
	import { cn } from '$lib/utils';

	let {
		icon: Icon,
		title,
		subtitle,
		bold = true,
		class: className = ''
	}: {
		icon: Component;
		title: string;
		subtitle: string;
		bold?: boolean;
		class?: string;
	} = $props();
</script>

<div class={cn('flex min-w-0 flex-1 items-center gap-2', className)}>
	<Avatar class="size-8 shrink-0 bg-primary">
		<AvatarFallback class="bg-primary text-primary-foreground">
			<Icon class="size-5" />
		</AvatarFallback>
	</Avatar>
	<div class="flex min-h-0 min-w-0 flex-col">
		<h3 class={cn('truncate leading-tight', bold && 'font-semibold')}>{title}</h3>
		<p class="truncate text-sm leading-tight text-muted-foreground">{subtitle}</p>
	</div>
</div>
