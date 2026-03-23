<script lang="ts">
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Button } from '$lib/components/ui/button';
	import type { LanguageSwitcherProps } from './types';
	import { haptic } from '$lib/hooks/use-haptic.svelte';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

	let {
		languages = [],
		value = $bindable(''),
		align = 'end',
		variant = 'outline',
		onChange,
		class: className
	}: LanguageSwitcherProps = $props();

	const firstCode = $derived(languages[0]?.code ?? '');

	// set default code if there isn't one selected
	$effect(() => {
		if (!value && firstCode) value = firstCode;
	});
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button
				{variant}
				size="icon"
				class={className}
				aria-label={$t('aria.change_language')}
				{...props}
			>
				<GlobeIcon class="size-4" />
				<span class="sr-only">{$t('aria.change_language')}</span>
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content {align}>
		<DropdownMenu.RadioGroup
			bind:value
			onValueChange={(v) => {
				haptic.trigger('light');
				onChange?.(v);
			}}
		>
			{#each languages as language (language.code)}
				<DropdownMenu.RadioItem value={language.code}>
					{language.label}
				</DropdownMenu.RadioItem>
			{/each}
		</DropdownMenu.RadioGroup>
	</DropdownMenu.Content>
</DropdownMenu.Root>
