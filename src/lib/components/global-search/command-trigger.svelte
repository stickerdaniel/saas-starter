<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Kbd from '$lib/components/ui/kbd/index.js';
	import { cn } from '$lib/utils.js';
	import { getTranslate } from '@tolgee/svelte';
	import { useGlobalSearchContext } from './context.svelte';

	interface Props {
		class?: string;
	}

	const { t } = getTranslate();

	let { class: className }: Props = $props();

	const globalSearch = useGlobalSearchContext();
</script>

<Button
	variant="secondary"
	class={cn(
		'bg-surface text-foreground dark:bg-card relative h-8 w-full justify-start pl-3 font-medium shadow-none md:w-48 lg:w-56 xl:w-64',
		className
	)}
	onclick={() => globalSearch.openMenu()}
	aria-label={$t('search.command.trigger_aria_label')}
>
	<span class="hidden lg:inline-flex">{$t('search.command.trigger_desktop')}</span>
	<span class="inline-flex lg:hidden">{$t('search.command.trigger_mobile')}</span>
	<div class="absolute end-1.5 top-1.5 hidden gap-1 sm:flex">
		<Kbd.Group>
			<Kbd.Root class="border">⌘</Kbd.Root>
			<Kbd.Root class="border">K</Kbd.Root>
		</Kbd.Group>
	</div>
</Button>
