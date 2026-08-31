<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';
	import { Toggle } from '$lib/components/ui/toggle';
	import { haptic } from '$lib/hooks/use-haptic.svelte.ts';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import IconSwap from '$lib/components/motion/icon-swap.svelte';
	import { usePasswordToggleVisibility } from './password.svelte.ts';
	import type { PasswordToggleVisibilityProps } from './types.js';
	import { cn } from '$lib/utils.js';

	const { t } = getTranslate();

	let { ref = $bindable(null), class: className }: PasswordToggleVisibilityProps = $props();

	const state = usePasswordToggleVisibility();
</script>

{#if state.root.passwordState.value}
	<!-- tabindex={-1}: click-only control, not reachable via Tab to keep focus in the form flow -->
	<Toggle
		bind:ref
		aria-label={$t(state.root.opts.hidden.current ? 'aria.show_password' : 'aria.hide_password')}
		tabindex={-1}
		bind:pressed={state.root.opts.hidden.current}
		onclick={() => haptic.trigger('light')}
		class={cn(
			'absolute top-1/2 right-0 size-9 min-w-0 -translate-y-1/2 p-0 opacity-0 transition-opacity group-focus-within/password:opacity-100 group-hover/password:opacity-100 hover:!bg-transparent data-[state=off]:text-muted-foreground hover:data-[state=off]:text-accent-foreground data-[state=on]:bg-transparent data-[state=on]:text-muted-foreground hover:data-[state=on]:text-accent-foreground',
			{
				'right-9 max-w-6': state.root.passwordState.copyMounted
			},
			className
		)}
	>
		<IconSwap showSecond={!state.root.opts.hidden.current} class="size-4">
			{#snippet first()}
				<EyeIcon class="size-4" />
			{/snippet}
			{#snippet second()}
				<EyeOffIcon class="size-4" />
			{/snippet}
		</IconSwap>
	</Toggle>
{/if}
