<script lang="ts">
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import type { Component } from 'svelte';
	import { cn } from '$lib/utils';
	import { userInitials } from '$lib/utils/user-initials';

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
		/** Identity for the initials; the title may be message text, so it never stands in. */
		fallbackText?: string;
		class?: string;
	} = $props();

	const initials = $derived(userInitials(fallbackText, undefined));
</script>

<div class={cn('flex min-w-0 flex-1 items-center gap-2', className)}>
	<Avatar surface="primary">
		{#if image}
			<AvatarImage src={image} alt={title} />
		{/if}
		<AvatarFallback variant="primary">
			{#if Icon}
				<Icon class="size-5" />
			{:else}
				<span class="text-xs font-medium">{initials}</span>
			{/if}
		</AvatarFallback>
	</Avatar>
	<div class="flex min-h-0 min-w-0 flex-col">
		<h3 class={cn('truncate leading-tight', bold && 'font-semibold')}>{title}</h3>
		<p class="truncate text-sm leading-tight text-muted-foreground">{subtitle}</p>
	</div>
</div>
