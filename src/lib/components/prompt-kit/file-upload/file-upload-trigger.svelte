<script lang="ts">
	import { fileUploadContext } from './file-upload-context.svelte';
	import type { Snippet } from 'svelte';

	type Props = {
		asChild?: boolean;
		class?: string;
		children: Snippet;
		onclick?: (e: MouseEvent) => void;
		[key: string]: any;
	};

	let { asChild = false, class: className, children, onclick, ...restProps }: Props = $props();

	const context = fileUploadContext.get();

	function handleClick(e: MouseEvent) {
		e.stopPropagation();
		context?.inputRef?.click();
		onclick?.(e);
	}
</script>

{#if asChild}
	<!-- When asChild, we don't add tabindex since the child element handles focus -->
	<div role="presentation" class={className} onclick={handleClick} {...restProps}>
		{@render children()}
	</div>
{:else}
	<button type="button" class={className} onclick={handleClick} {...restProps}>
		{@render children()}
	</button>
{/if}
