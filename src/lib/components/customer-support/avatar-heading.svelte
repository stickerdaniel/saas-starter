<script lang="ts">
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import type { Component } from 'svelte';
	import { cn } from '$lib/utils';

	let {
		icon: Icon,
		image,
		title,
		subtitle,
		bold = true,
		fallbackText,
		class: className = ''
	}: {
		icon?: Component;
		image?: string | null;
		title: string;
		subtitle: string;
		bold?: boolean;
		fallbackText?: string;
		class?: string;
	} = $props();
</script>

<div class={cn('flex min-w-0 flex-1 items-center gap-2', className)}>
	<Avatar class="size-8 shrink-0 bg-primary">
		{#if image}
			<AvatarImage src={image} alt={title} />
		{/if}
		<AvatarFallback class="bg-primary text-primary-foreground">
			{#if Icon}
				<Icon class="size-5" />
			{:else}
				<span class="text-xs font-medium">{(fallbackText ?? title).charAt(0).toUpperCase()}</span>
			{/if}
		</AvatarFallback>
	</Avatar>
	<div class="flex min-h-0 min-w-0 flex-col">
		<h3 class={cn('truncate leading-tight', bold && 'font-semibold')}>{title}</h3>
		<p class="truncate text-sm leading-tight text-muted-foreground">{subtitle}</p>
	</div>
</div>
