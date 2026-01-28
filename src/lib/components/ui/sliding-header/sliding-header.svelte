<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import { fly } from 'svelte/transition';
	import { cubicOut, backOut } from 'svelte/easing';
	import { Button } from '$lib/components/ui/button';
	import NavigationButton from '$lib/components/customer-support/navigation-button.svelte';
	import AvatarHeading from '$lib/components/customer-support/avatar-heading.svelte';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import MessagesSquareIcon from '@lucide/svelte/icons/messages-square';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

	interface Props {
		// View state
		isBackView: boolean;

		// Content
		defaultIcon?: Component;
		backTitle: string;
		backSubtitle?: string;
		defaultTitle: string;

		// Icons
		backIcon?: Component;
		titleIcon?: Component;
		titleImage?: string | null; // Profile picture URL

		// Callbacks
		onBackClick: () => void;
		onCloseClick?: () => void;

		// Styling
		class?: string;
		showClose?: boolean;

		// Actions
		actions?: Snippet;
	}

	let {
		isBackView,
		defaultIcon = MessagesSquareIcon,
		backTitle,
		backSubtitle,
		defaultTitle,
		backIcon = ChevronLeftIcon,
		titleIcon,
		titleImage,
		onBackClick,
		onCloseClick,
		class: className,
		showClose = true,
		actions
	}: Props = $props();
</script>

<header class="flex shrink-0 items-center gap-2 border-b border-border/50 p-4 {className}">
	<!-- Left: Animated icon swap (based on view state) -->
	<div class="relative flex size-10 items-center justify-center">
		<!-- Default icon (visible when NOT in back view) -->
		{#if !isBackView}
			<div
				in:fly={{ x: 20, duration: 200, easing: backOut }}
				out:fly={{ x: -20, duration: 200, easing: cubicOut }}
				class="absolute inset-0 flex items-center justify-center"
			>
				<svelte:component this={defaultIcon} class="size-5 text-muted-foreground" />
			</div>
		{/if}

		<!-- Back button (visible when in back view) -->
		{#if isBackView}
			<div
				in:fly={{ x: 20, duration: 200, easing: backOut }}
				out:fly={{ x: -20, duration: 200, easing: cubicOut }}
				class="absolute inset-0 flex items-center justify-center"
			>
				<Button
					variant="ghost"
					size="icon"
					class="h-10 w-10 rounded-full hover:!bg-muted-foreground/10"
					aria-label={$t('aria.go_back')}
					onclick={onBackClick}
				>
					<svelte:component this={backIcon} class="size-5" />
				</Button>
			</div>
		{/if}
	</div>

	<!-- Center: Animated title swap (vertical slide with grid stacking) -->
	<div
		class="relative grid min-w-0 flex-1 py-1"
		style="mask-image: linear-gradient(to bottom, transparent 0%, black 4px, black calc(100% - 4px), transparent 100%);"
	>
		<!-- Default title -->
		{#if !isBackView}
			<div
				in:fly={{ y: -40, duration: 300, easing: backOut }}
				out:fly={{ y: 40, duration: 300, easing: cubicOut }}
				class="col-start-1 row-start-1 flex h-10 items-center"
			>
				<h2 class="text-xl leading-none font-semibold">{defaultTitle}</h2>
			</div>
		{/if}

		<!-- Back view title -->
		{#if isBackView}
			<div
				in:fly={{ y: -40, duration: 300, easing: backOut }}
				out:fly={{ y: 40, duration: 300, easing: cubicOut }}
				class="col-start-1 row-start-1 flex h-10 items-center"
			>
				{#if titleIcon || titleImage}
					<AvatarHeading
						icon={titleIcon}
						image={titleImage}
						title={backTitle}
						subtitle={backSubtitle || ''}
					/>
				{:else}
					<div class="flex flex-col justify-center">
						<h2 class="text-base leading-tight font-semibold">{backTitle}</h2>
						{#if backSubtitle}
							<p class="text-xs text-muted-foreground">{backSubtitle}</p>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Right: Action buttons + Close button -->
	<div class="flex items-center gap-2">
		<!-- Custom actions if provided -->
		{#if actions}
			{@render actions()}
		{/if}

		<!-- Close button (optional) -->
		{#if showClose && onCloseClick}
			<NavigationButton type="close" onclick={onCloseClick} />
		{/if}
	</div>
</header>
