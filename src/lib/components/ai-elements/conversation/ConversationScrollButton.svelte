<script lang="ts" module>
	import { cn } from '$lib/utils';
	import type {
		ButtonPropsWithoutHTML,
		ButtonVariant,
		ButtonSize
	} from '$lib/components/ui/button/index.js';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import type { WithoutChildren } from 'bits-ui';

	export type ConversationScrollButtonProps = ButtonPropsWithoutHTML &
		WithoutChildren<Omit<HTMLButtonAttributes, 'type'>> & {
			variant?: ButtonVariant;
			size?: ButtonSize;
		};
</script>

<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { ArrowDown } from '@lucide/svelte';
	import { stickToBottomContext } from './stick-to-bottom-context.svelte.js';
	import { fly } from 'svelte/transition';
	import { backOut } from 'svelte/easing';

	let { class: className, onclick, ...restProps }: ConversationScrollButtonProps = $props();

	const context = stickToBottomContext.get();

	const handleScrollToBottom = (event: MouseEvent) => {
		context.scrollToBottom();
		if (onclick) {
			onclick(
				event as MouseEvent & {
					currentTarget: EventTarget & HTMLButtonElement;
				}
			);
		}
	};
</script>

{#if !context.isAtBottom}
	<div
		in:fly={{
			duration: 300,
			y: 10,
			easing: backOut
		}}
		out:fly={{
			duration: 200,
			y: 10,
			easing: backOut
		}}
		class="absolute bottom-4 left-[50%] translate-x-[-50%]"
	>
		<Button
			class={cn(
				'rounded-full border-border/50 bg-background/80 shadow-lg backdrop-blur-sm hover:bg-background/90 hover:shadow-xl',
				className
			)}
			onclick={handleScrollToBottom}
			size="icon"
			type="button"
			variant="outline"
			{...restProps}
		>
			<ArrowDown class="size-4" />
		</Button>
	</div>
{/if}
