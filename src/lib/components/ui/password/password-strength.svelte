<script lang="ts">
	import { tv } from 'tailwind-variants';
	import { usePasswordStrength } from './password.svelte.ts';
	import type { PasswordStrengthProps } from './types.js';
	import { Meter } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let { strength = $bindable(), class: className }: PasswordStrengthProps = $props();

	const state = usePasswordStrength();

	const score = $derived(state.strength.score);

	$effect(() => {
		strength = state.strength;
	});

	// The bar fills a quarter per score step.
	const indicator = tv({
		base: '',
		variants: {
			score: {
				0: 'w-0 bg-destructive',
				1: 'w-1/4 bg-destructive',
				2: 'w-1/2 bg-warning',
				3: 'w-3/4 bg-warning',
				4: 'w-full bg-success'
			}
		}
	});
</script>

<Meter.Root
	value={state.strength.score}
	class={cn('relative h-1.5 w-full gap-1 overflow-hidden rounded-full bg-accent', className)}
	min={0}
	max={4}
>
	<div class={cn('h-full transition-all duration-500', indicator({ score }))}></div>
	<div class="absolute top-0 left-0 z-10 flex h-1.5 w-full place-items-center gap-1">
		{#each Array.from({ length: 4 }) as _, i (i)}
			<div class="h-1.5 w-1/4 rounded-full ring-3 ring-card"></div>
		{/each}
	</div>
</Meter.Root>
