<script lang="ts">
	import { IsUsingKeyboard } from 'bits-ui';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import LanguageSwitcherButton from './language-switcher-button.svelte';
	import type { LanguageSwitcherProps } from './types';
	import { haptic } from '#lib/hooks/use-haptic.svelte.ts';

	let {
		languages = [],
		value = $bindable(''),
		open = $bindable(false),
		trigger = $bindable(null),
		openedWithKeyboard = false,
		align = 'end',
		variant = 'outline',
		onChange,
		onIntent,
		class: className
	}: LanguageSwitcherProps = $props();

	const firstCode = $derived(languages[0]?.code ?? '');

	// set default code if there isn't one selected
	$effect(() => {
		if (!value && firstCode) value = firstCode;
	});

	// Bits UI moves focus to the first item only for a keyboard user, which it
	// learns from a keydown it saw. A key pressed before this menu loaded never
	// reached it.
	const keyboard = new IsUsingKeyboard();
	// svelte-ignore state_referenced_locally
	if (openedWithKeyboard) keyboard.current = true;
</script>

<DropdownMenu.Root bind:open>
	<DropdownMenu.Trigger bind:ref={trigger}>
		{#snippet child({ props })}
			<LanguageSwitcherButton {variant} class={className} {...props} />
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
				<DropdownMenu.RadioItem
					value={language.code}
					onpointerenter={() => onIntent?.(language.code)}
					onfocus={() => onIntent?.(language.code)}
				>
					{language.label}
				</DropdownMenu.RadioItem>
			{/each}
		</DropdownMenu.RadioGroup>
	</DropdownMenu.Content>
</DropdownMenu.Root>
