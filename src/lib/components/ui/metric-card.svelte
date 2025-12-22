<script lang="ts">
	import TrendingDownIcon from '@lucide/svelte/icons/trending-down';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { cn } from '$lib/utils.js';
	import type { Component } from 'svelte';
	import { motion } from 'motion-sv';

	interface Props {
		label: string;
		value: string | number;
		icon?: Component<{ class?: string }>;
		trend?: {
			value: string;
			direction: 'up' | 'down' | 'neutral';
		};
		description?: string;
		subtitle?: string;
		variant?: 'default' | 'destructive';
		loading?: boolean;
		class?: string;
	}

	let {
		label,
		value,
		icon,
		trend,
		description,
		subtitle,
		variant = 'default',
		loading = false,
		class: className
	}: Props = $props();
</script>

<Card.Root
	class={cn('@container/card', variant === 'destructive' && 'border-destructive/50', className)}
	data-slot="card"
>
	<Card.Header>
		<Card.Description class={cn(variant === 'destructive' && 'text-destructive')}>
			{label}
		</Card.Description>
		<Card.Title
			class={cn(
				'flex items-center gap-2 text-2xl font-semibold tabular-nums @[250px]/card:text-3xl',
				variant === 'destructive' && 'text-destructive'
			)}
		>
			{#if icon}
				{@const Icon = icon}
				<Icon class="size-5" />
			{/if}
			<span class="relative inline-block">
				<!-- Invisible placeholder to reserve space -->
				<span class="invisible">{value}</span>
				<!-- Animated value positioned on top -->
				{#if !loading}
					<motion.span
						initial={{ opacity: 0, y: 6, filter: 'blur(6px)' }}
						animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
						transition={{ duration: 0.4, delay: 0.04, ease: 'easeOut' }}
						class="absolute inset-0"
					>
						{value}
					</motion.span>
				{/if}
			</span>
		</Card.Title>
		{#if trend}
			<Card.Action>
				<Badge
					variant="outline"
					class={cn(
						trend.direction === 'down' && 'text-destructive',
						trend.direction === 'up' && 'text-emerald-600 dark:text-emerald-500'
					)}
				>
					{#if trend.direction === 'up'}
						<TrendingUpIcon class="size-3" />
					{:else if trend.direction === 'down'}
						<TrendingDownIcon class="size-3" />
					{/if}
					{trend.value}
				</Badge>
			</Card.Action>
		{/if}
	</Card.Header>
	{#if description || subtitle}
		<Card.Footer class="flex-col items-start gap-1.5 text-sm">
			{#if description}
				<div class="line-clamp-1 flex gap-2 font-medium">
					{description}
					{#if trend?.direction === 'up'}
						<TrendingUpIcon class="size-4" />
					{:else if trend?.direction === 'down'}
						<TrendingDownIcon class="size-4" />
					{/if}
				</div>
			{/if}
			{#if subtitle}
				<div class="text-muted-foreground">
					{subtitle}
				</div>
			{/if}
		</Card.Footer>
	{/if}
</Card.Root>
