<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';
	import type { DocsHeading } from '#lib/docs/headings.js';

	let { headings }: { headings: readonly DocsHeading[] } = $props();

	const { t } = getTranslate();

	function flatten(tree: readonly DocsHeading[]): DocsHeading[] {
		return tree.flatMap((heading) => [heading, ...flatten(heading.children)]);
	}

	const items = $derived(flatten(headings));
	const shallowest = $derived(Math.min(...items.map((item) => item.depth)));
	let active = $state<string | null>(null);

	$effect(() => {
		const headings = items.flatMap((item) => document.getElementById(item.id) ?? []);
		const root = document.documentElement;
		let frame = 0;
		const reached = (heading: HTMLElement) =>
			heading.getBoundingClientRect().top <
			parseFloat(getComputedStyle(heading).scrollMarginTop) + 1;
		const update = () => {
			frame = 0;
			const atEnd =
				root.scrollHeight > innerHeight && scrollY + innerHeight >= root.scrollHeight - 1;
			const passed = atEnd ? headings.at(-1) : headings.findLast(reached);
			active = passed?.id ?? headings[0]?.id ?? null;
		};
		const schedule = () => {
			frame ||= requestAnimationFrame(update);
		};
		update();
		addEventListener('scroll', schedule, { passive: true });
		addEventListener('resize', schedule, { passive: true });
		return () => {
			cancelAnimationFrame(frame);
			removeEventListener('scroll', schedule);
			removeEventListener('resize', schedule);
		};
	});
</script>

{#if items.length > 0}
	<nav aria-labelledby="docs-toc-title" class="flex flex-col gap-2 p-4 pt-0 text-sm">
		<p
			id="docs-toc-title"
			class="sticky top-0 h-6 bg-background text-xs leading-4 text-muted-foreground"
		>
			{$t('docs.on_this_page')}
		</p>
		{#each items as item (item.id)}
			<a
				href="#{item.id}"
				aria-current={active === item.id ? 'location' : undefined}
				class={[
					'text-nav text-muted-foreground no-underline transition-colors hover:text-foreground aria-[current=location]:text-foreground',
					item.depth - shallowest === 1 && 'ps-4',
					item.depth - shallowest >= 2 && 'ps-6'
				]}
			>
				{item.text}
			</a>
		{/each}
	</nav>
{/if}
