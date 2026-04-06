<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { resolve } from '$app/paths';
	import { haptic } from '$lib/hooks/use-haptic.svelte';
	import autoAnimate from '@formkit/auto-animate';
	import { getTranslate } from '@tolgee/svelte';
	import type { NavSubItem } from './types';

	const { t } = getTranslate();

	const THREAD_PREVIEW_LIMIT = 10;
	const THREAD_LOAD_MORE_STEP = 5;

	interface Props {
		items: NavSubItem[];
	}

	let { items }: Props = $props();

	function timeAgo(timestamp: number): string {
		const diff = Date.now() - timestamp;
		const minutes = Math.floor(diff / 60_000);
		if (minutes < 1) return 'now';
		if (minutes < 60) return `${minutes}m`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h`;
		return `${Math.floor(hours / 24)}d`;
	}

	// Client-side display limit (same pattern as t3code's THREAD_PREVIEW_LIMIT).
	// "Show more" only changes this local state — no server re-fetch, no parent
	// re-render, so autoAnimate sees only newly appended DOM nodes.
	let displayLimit = $state(THREAD_PREVIEW_LIMIT);
	const visibleItems: NavSubItem[] = $derived(items.slice(0, displayLimit));
	const hasMore = $derived(items.length > displayLimit);

	let listRef = $state<HTMLElement | null>(null);
	const animatedNodes = new WeakSet<HTMLElement>();

	$effect(() => {
		if (!listRef || animatedNodes.has(listRef)) return;
		autoAnimate(listRef, { duration: 180, easing: 'ease-out' });
		animatedNodes.add(listRef);
	});
</script>

{#if items.length > 0}
	<!-- data-tolgee-restricted: thread previews may contain ZWNJ/ZWJ (tolgee/tolgee-js#3475) -->
	<Sidebar.MenuSub
		bind:ref={listRef}
		data-tolgee-restricted
		class="no-scrollbar max-h-[calc(100svh-18rem)] overflow-y-auto"
	>
		{#each visibleItems as sub (sub.id)}
			<Sidebar.MenuSubItem>
				<Sidebar.MenuSubButton isActive={sub.isActive} onclick={() => haptic.trigger('light')}>
					{#snippet child({ props })}
						<a href={resolve(sub.url)} {...props} class="{props.class} flex items-center gap-1">
							<span class="min-w-0 truncate">{sub.label}</span>
							{#if sub.timestamp}
								<span class="ml-auto shrink-0 text-[11px] text-muted-foreground/50">
									{timeAgo(sub.timestamp)}
								</span>
							{/if}
						</a>
					{/snippet}
				</Sidebar.MenuSubButton>
			</Sidebar.MenuSubItem>
		{/each}
		{#if hasMore}
			<Sidebar.MenuSubItem>
				<button
					class="w-full px-2 py-1 text-left text-xs text-muted-foreground hover:text-foreground active:translate-y-px"
					onclick={() => {
						haptic.trigger('light');
						displayLimit += THREAD_LOAD_MORE_STEP;
					}}
				>
					{$t('app.sidebar.show_more')}
				</button>
			</Sidebar.MenuSubItem>
		{/if}
	</Sidebar.MenuSub>
{/if}
