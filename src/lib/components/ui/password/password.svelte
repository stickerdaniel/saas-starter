<script lang="ts">
	import { box } from 'svelte-toolbelt';
	import { usePassword } from './password.svelte.js';
	import type { PasswordRootProps } from './types';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		hidden = $bindable(true),
		minScore = 3,
		validationMessage = 'Password is too weak',
		class: className,
		children
	}: PasswordRootProps = $props();

	usePassword({
		hidden: box.with(
			() => hidden,
			(v) => (hidden = v)
		),
		minScore: box.with(() => minScore),
		validationMessage: box.with(() => validationMessage)
	});
</script>

<div bind:this={ref} class={cn('flex flex-col gap-2', className)}>
	{@render children?.()}
</div>
