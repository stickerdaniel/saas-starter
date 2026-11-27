<script lang="ts">
	import type { Snippet } from 'svelte';
	import { getTranslate } from '@tolgee/svelte';
	import { IsUsingKeyboard } from 'bits-ui';
	import { resolve } from '$app/paths';
	import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import type { LazyMenuProps } from './lazy-menu.svelte.ts';

	let {
		open = $bindable(false),
		trigger = $bindable(null),
		openedWithKeyboard,
		button,
		markdownPath,
		pageUrl
	}: LazyMenuProps & {
		button: Snippet<[Record<string, unknown>]>;
		markdownPath: string;
		pageUrl: string;
	} = $props();

	const { t } = getTranslate();

	const keyboard = new IsUsingKeyboard();
	// svelte-ignore state_referenced_locally
	if (openedWithKeyboard) keyboard.current = true;

	const prompt = $derived($t('docs.ask_prompt', { url: pageUrl }));
	const assistants = $derived([
		{ name: 'ChatGPT', href: `https://chatgpt.com/?${new URLSearchParams({ q: prompt })}` },
		{ name: 'Claude', href: `https://claude.ai/new?${new URLSearchParams({ q: prompt })}` }
	]);
</script>

<DropdownMenu.Root bind:open>
	<DropdownMenu.Trigger bind:ref={trigger}>
		{#snippet child({ props })}
			{@render button(props)}
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="w-48">
		<DropdownMenu.Item>
			{#snippet child({ props })}
				<a {...props} href={resolve(markdownPath)} target="_blank" rel="noopener noreferrer">
					<FileTextIcon aria-hidden="true" />
					{$t('docs.view_markdown')}
				</a>
			{/snippet}
		</DropdownMenu.Item>
		{#each assistants as assistant (assistant.name)}
			<DropdownMenu.Item>
				{#snippet child({ props })}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an external chat app, outside the app's routes -->
					<a {...props} href={assistant.href} target="_blank" rel="noopener noreferrer">
						<ArrowUpRightIcon aria-hidden="true" />
						{$t('docs.open_in', { app: assistant.name })}
					</a>
				{/snippet}
			</DropdownMenu.Item>
		{/each}
	</DropdownMenu.Content>
</DropdownMenu.Root>
