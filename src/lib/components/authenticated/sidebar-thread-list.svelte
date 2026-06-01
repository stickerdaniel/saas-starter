<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
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

	// Locale-aware compact timestamp ("05/30, 02:35 PM" / "30.05., 14:35"),
	// revealed on row hover. Reactive on the route language so switching locales
	// reformats live.
	const dateFormatter = $derived(
		new Intl.DateTimeFormat(page.params.lang ?? 'en', {
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		})
	);

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
						</a>
					{/snippet}
				</Sidebar.MenuSubButton>
				<!-- Last-activity timestamp, revealed on row hover. Absolutely placed so
				     it never steals width from the title when hidden. The background is the
				     opaque match for the row's hover colour (sidebar-accent-hover), switching
				     to sidebar-accent only once the row is the active thread; pressing keeps
				     the hover colour (and dips with translate-y-px) to match the row. A left
				     mask fades that edge into the title, pure alpha so it never muddies the
				     colour. pointer-events-none keeps the row link clickable. -->
				{#if sub.timestamp}
					<span
						class="pointer-events-none absolute inset-y-0 -right-2 flex items-center justify-end overflow-hidden rounded-r-md bg-sidebar-accent-hover [mask-image:linear-gradient(to_right,transparent,#000_1rem)] pr-3 pl-5 text-xs whitespace-nowrap text-muted-foreground opacity-0 group-hover/menu-sub-item:opacity-100 group-active/menu-sub-item:translate-y-px group-has-data-[active=true]/menu-sub-item:bg-sidebar-accent"
					>
						{dateFormatter.format(sub.timestamp)}
					</span>
				{/if}
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
