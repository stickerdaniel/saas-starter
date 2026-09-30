<script lang="ts">
	import { onMount } from 'svelte';
	import { T, getTranslate } from '@tolgee/svelte';
	import { toast } from 'svelte-sonner';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { analyticsPreferencesContext } from '$lib/analytics/preferences.svelte.ts';
	import { localizedHref } from '$lib/utils/i18n';

	const preferences = analyticsPreferencesContext.get();
	const { t } = getTranslate();
	let region = $state<HTMLElement>();

	onMount(() => {
		// Reopened by the visitor: move focus to the choice they asked for. A first
		// visit does not steal focus from the page.
		if (preferences.state.status !== 'pending') region?.focus();
	});

	function allow(): void {
		if (!preferences.allow()) toast.error($t('analytics.consent.storage_failed'));
	}

	function decline(): void {
		if (!preferences.decline()) toast.error($t('analytics.consent.decline_storage_failed'));
	}

	// Escape dismisses only a reopened banner; a first visit still needs a choice.
	function onkeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') preferences.close();
	}
</script>

<svelte:window {onkeydown} />

<!-- Bottom left from sm up, clear of the support launcher at the bottom right. On
	narrow screens it spans the width above the launcher. -->
<section
	bind:this={region}
	role="region"
	aria-labelledby="analytics-consent-title"
	tabindex="-1"
	data-testid="analytics-consent-banner"
	class="fixed inset-x-4 bottom-24 z-50 rounded-xl bg-popover p-4 text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none sm:inset-x-auto sm:bottom-5 sm:left-5 sm:max-w-sm"
>
	<h2 id="analytics-consent-title" class="text-sm font-medium">
		<T keyName="analytics.consent.title" />
	</h2>
	<p class="mt-1 text-sm text-muted-foreground">
		<T keyName="analytics.consent.description" />
		<a
			href={resolve(localizedHref('/privacy'))}
			class="underline underline-offset-4 hover:text-foreground"
		>
			<T keyName="analytics.consent.privacy_link" />
		</a>
	</p>
	<div class="mt-4 grid grid-cols-2 gap-2">
		<Button variant="outline" size="sm" onclick={decline}>
			<T keyName="analytics.consent.decline" />
		</Button>
		<Button size="sm" onclick={allow}>
			<T keyName="analytics.consent.allow" />
		</Button>
	</div>
</section>
