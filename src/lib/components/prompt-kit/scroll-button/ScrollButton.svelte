<script lang="ts" module>
	import { cn } from '$lib/utils';
	import { type ButtonSize, type ButtonVariant } from '$lib/components/ui/button/index.js';

	export type ScrollButtonProps = {
		class?: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		ref?: HTMLElement | null;
		onclick?: (event: MouseEvent) => void;
	};
</script>

<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { getChatContainerContext } from '../chat-container/chat-container-context.svelte.js';
	import { browser } from '$app/environment';

	let {
		class: className,
		variant = 'outline',
		size = 'sm',
		ref = $bindable(null),
		onclick
	}: ScrollButtonProps = $props();

	// Lazy context retrieval to avoid SSR issues
	let scrollContext: ReturnType<typeof getChatContainerContext> | null = null;

	// Only get context in browser
	if (browser) {
		scrollContext = getChatContainerContext();
	}

	const isAtBottom = $derived(scrollContext?.isAtBottom ?? true);

	const handleClick = (event: MouseEvent) => {
		scrollContext?.scrollToBottom();
		onclick?.(event);
	};
</script>

<Button
	bind:ref
	{variant}
	{size}
	class={cn(
		'h-10 w-10 rounded-full transition-all duration-150 ease-out',
		!isAtBottom
			? 'translate-y-0 scale-100 opacity-100'
			: 'pointer-events-none translate-y-4 scale-95 opacity-0',
		className
	)}
	onclick={handleClick}
>
	<ChevronDown class="h-5 w-5" />
</Button>
