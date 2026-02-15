<script lang="ts" module>
	import { cn } from '$lib/utils';
	import { type ButtonSize, type ButtonVariant } from '$lib/components/ui/button/index.js';

	export type ScrollButtonProps = {
		class?: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		ref?: HTMLElement | null;
		isAtBottom?: boolean;
		onScrollToBottom?: () => void;
		onclick?: (event: MouseEvent) => void;
	};
</script>

<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { getTranslate } from '@tolgee/svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { chatContainerContext } from '../chat-container/chat-container-context.svelte.js';
	import { browser } from '$app/environment';

	const { t } = getTranslate();

	let {
		class: className,
		variant = 'outline',
		size = 'sm',
		ref = $bindable(null),
		isAtBottom,
		onScrollToBottom,
		onclick
	}: ScrollButtonProps = $props();

	// Lazy context retrieval to avoid SSR issues
	const scrollContext = browser ? chatContainerContext.getOr(null) : null;

	const resolvedIsAtBottom = $derived(isAtBottom ?? scrollContext?.isAtBottom ?? true);

	const handleClick = (event: MouseEvent) => {
		if (onScrollToBottom) {
			onScrollToBottom();
		} else {
			scrollContext?.scrollToBottom();
		}
		onclick?.(event);
	};
</script>

<Button
	bind:ref
	{variant}
	{size}
	aria-label={$t('aria.scroll_to_bottom')}
	class={cn(
		'h-10 w-10 rounded-full transition-all duration-150 ease-out',
		!resolvedIsAtBottom
			? 'translate-y-0 scale-100 opacity-100'
			: 'pointer-events-none translate-y-4 scale-95 opacity-0',
		className
	)}
	onclick={handleClick}
>
	<ChevronDown class="h-5 w-5" />
</Button>
