<script lang="ts" module>
	import type { ButtonVariant, ButtonSize } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';

	export type PromptSuggestionProps = Omit<
		HTMLButtonAttributes & HTMLAnchorAttributes,
		'class' | 'onclick' | 'disabled' | 'type' | 'children'
	> & {
		children?: Snippet;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		highlight?: string;
		ref?: HTMLElement | null;
		onclick?: (event: MouseEvent) => void;
		disabled?: boolean;
		type?: 'button' | 'submit' | 'reset';
		/** Wrap children in a truncating span. Non-highlight mode only — ignored when `highlight` is set. */
		truncate?: boolean;
	};
</script>

<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';

	let {
		children,
		variant = undefined,
		size = undefined,
		class: className,
		highlight = undefined,
		ref = $bindable(null),
		onclick,
		disabled,
		type = 'button',
		truncate = false,
		...rest
	}: PromptSuggestionProps = $props();

	const isHighlightMode = $derived(highlight !== undefined && highlight.trim() !== '');
	const content = $derived(typeof children === 'string' ? (children as string) : '');

	const highlightedContent = $derived.by(() => {
		if (!isHighlightMode || !content) {
			return null;
		}

		const trimmedHighlight = highlight!.trim();
		const contentLower = content.toLowerCase();
		const highlightLower = trimmedHighlight.toLowerCase();
		const shouldHighlight = contentLower.includes(highlightLower);

		if (!shouldHighlight) {
			return {
				before: '',
				highlighted: '',
				after: '',
				text: content,
				hasMatch: false
			};
		}

		const index = contentLower.indexOf(highlightLower);
		if (index === -1) {
			return {
				before: '',
				highlighted: '',
				after: '',
				text: content,
				hasMatch: false
			};
		}

		const actualHighlightedText = content.substring(index, index + highlightLower.length);
		const before = content.substring(0, index);
		const after = content.substring(index + actualHighlightedText.length);

		return {
			before,
			highlighted: actualHighlightedText,
			after,
			text: '',
			hasMatch: true
		};
	});
</script>

<!-- Pill-shaped by default; collapses to sharp corners when the active theme
	 sets --radius: 0 (fully squared-off themes). sign() is 0 at a zero radius,
	 1 otherwise. -->
{#if !isHighlightMode}
	<Button
		bind:ref
		variant={variant || 'outline'}
		size={size || 'lg'}
		class={cn('min-w-0 rounded-[calc(9999px*sign(var(--radius)))] px-4', className)}
		{onclick}
		{disabled}
		{type}
		{...rest}
	>
		{#if truncate}
			<span class="block min-w-0 truncate">
				{@render children?.()}
			</span>
		{:else}
			{@render children?.()}
		{/if}
	</Button>
{:else if !content}
	<Button
		bind:ref
		variant={variant || 'ghost'}
		size={size || 'sm'}
		class={cn('w-full cursor-pointer justify-start rounded-xl py-2', 'hover:bg-accent', className)}
		{onclick}
		{disabled}
		{type}
		{...rest}
	>
		{@render children?.()}
	</Button>
{:else}
	<Button
		bind:ref
		variant={variant || 'ghost'}
		size={size || 'sm'}
		class={cn(
			'w-full cursor-pointer justify-start gap-0 rounded-xl py-2',
			'hover:bg-accent',
			className
		)}
		{onclick}
		{disabled}
		{type}
		{...rest}
	>
		{#if highlightedContent?.hasMatch}
			{#if highlightedContent.before}
				<span class="whitespace-pre-wrap text-muted-foreground">
					{highlightedContent.before}
				</span>
			{/if}
			<span class="font-medium whitespace-pre-wrap text-primary">
				{highlightedContent.highlighted}
			</span>
			{#if highlightedContent.after}
				<span class="whitespace-pre-wrap text-muted-foreground">
					{highlightedContent.after}
				</span>
			{/if}
		{:else}
			<span class="whitespace-pre-wrap text-muted-foreground">
				{highlightedContent?.text || content}
			</span>
		{/if}
	</Button>
{/if}
