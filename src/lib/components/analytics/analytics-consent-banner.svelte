<script lang="ts">
	import { T, getTranslate } from '@tolgee/svelte';
	import { untrack } from 'svelte';
	import { quintOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import type { TransitionConfig } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { analyticsPreferencesContext } from '#lib/analytics/preferences.svelte.ts';
	import { localizedHref } from '#lib/utils/i18n.js';

	const preferences = analyticsPreferencesContext.get();
	const { t } = getTranslate();
	const open = $derived(preferences.state.enabled && preferences.state.bannerOpen);

	function allow(): void {
		if (!preferences.allow()) toast.error($t('analytics.consent.storage_failed'));
	}

	function decline(): void {
		if (!preferences.decline()) toast.error($t('analytics.consent.decline_storage_failed'));
	}

	// Escape dismisses only a reopened banner; a first visit still needs a choice.
	function onkeydown(event: KeyboardEvent): void {
		if (open && event.key === 'Escape') preferences.close();
	}

	// Reopened by the visitor: move focus to the choice they asked for. A first visit
	// does not steal focus from the page.
	function focusWhenReopened(node: HTMLElement): void {
		if (untrack(() => preferences.state.status) !== 'pending') node.focus();
	}

	// Toast-style rise: fade, short upward travel, slight scale and a cross-blur.
	// Svelte runs the same css() backwards for the outro, so entering and leaving
	// differ only in their parameters. Under reduced motion only the fade remains.
	function rise(
		_node: Element,
		{ duration, y, scale, blur }: { duration: number; y: number; scale: number; blur: number }
	): TransitionConfig {
		const still = prefersReducedMotion.current;
		const travel = still ? 0 : y;
		const shrink = still ? 0 : 1 - scale;
		const soften = still ? 0 : blur;
		return {
			duration,
			easing: quintOut,
			css: (t, u) =>
				`opacity: ${t}; transform: translateY(${u * travel}px) scale(${1 - u * shrink}); filter: blur(${u * soften}px)`
		};
	}
</script>

<svelte:window {onkeydown} />

{#if open}
	<!-- Mirrors the support launcher (right-5 bottom-5): bottom left from sm up, and on
		narrow screens above it with the support panel's gap. -->
	<div
		class="fixed inset-x-5 bottom-20 z-50 origin-bottom-left rounded-xl shadow-lg sm:inset-x-auto sm:bottom-5 sm:left-5 sm:w-sm"
		in:rise={{ duration: 350, y: 16, scale: 0.97, blur: 2 }}
		out:rise={{ duration: 200, y: 8, scale: 0.98, blur: 2 }}
	>
		<Card.Root
			{@attach focusWhenReopened}
			size="sm"
			role="region"
			aria-labelledby="analytics-consent-title"
			tabindex={-1}
			data-testid="analytics-consent-banner"
		>
			<Card.Header>
				<Card.Title id="analytics-consent-title">
					<T keyName="analytics.consent.title" />
				</Card.Title>
				<Card.Description>
					<T keyName="analytics.consent.description" />
					<a
						href={resolve(localizedHref('/privacy'))}
						class="underline underline-offset-4 hover:text-foreground"
					>
						<T keyName="analytics.consent.privacy_link" />
					</a>
				</Card.Description>
			</Card.Header>
			<Card.Footer class="grid grid-cols-2 gap-2">
				<Button variant="outline" onclick={decline}>
					<T keyName="analytics.consent.decline" />
				</Button>
				<Button onclick={allow}>
					<T keyName="analytics.consent.allow" />
				</Button>
			</Card.Footer>
		</Card.Root>
	</div>
{/if}
