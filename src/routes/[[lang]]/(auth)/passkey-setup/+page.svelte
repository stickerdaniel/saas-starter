<script lang="ts">
	import { onDestroy } from 'svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { useConvexClient } from 'convex-svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { T, getTranslate } from '@tolgee/svelte';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import AuthPanel from '$lib/components/auth/auth-panel.svelte';
	import * as Field from '$lib/components/ui/field';
	import { Button } from '$lib/components/ui/button';
	import PasskeyOffer from '$lib/components/auth/passkey-offer.svelte';
	import { claimPasskeyNudge, type PasskeyNudgeUser } from '$lib/utils/passkey-nudge';
	import { localizedHref } from '$lib/utils/i18n';

	let { data } = $props();
	const auth = useAuth();
	const client = useConvexClient();
	const { t } = getTranslate();
	let user = $state<PasskeyNudgeUser | null>(null);
	let started = false;
	let destroyed = false;
	onDestroy(() => {
		destroyed = true;
	});
	// resolve() reads its whole argument as a route and rewrites slashes inside the query and
	// hash, so only the path goes through it; the validated query and hash pass unchanged.
	const destination = $derived(new URL(data.destination, 'http://destination.invalid'));
	const destinationHref = $derived(
		resolve(destination.pathname) + destination.search + destination.hash
	);
	function continueToApp() {
		window.location.replace(destinationHref);
	}
	// A client-side move keeps the root toaster mounted, so the confirmation stays visible.
	function finishEnrollment() {
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- The path is resolved above; only the untouched query and hash follow it
		void goto(destinationHref, { replaceState: true });
	}

	$effect(() => {
		if (auth.isLoading || !auth.isAuthenticated || started) return;
		started = true;
		void claimPasskeyNudge(client).then((eligible) => {
			if (destroyed) return;
			if (eligible) user = eligible;
			else continueToApp();
		});
	});
</script>

<SEOHead
	title={$t('auth.passkey_nudge.title')}
	description={$t('auth.passkey_nudge.description')}
	noindex
/>

<AuthPanel>
	{#if user}
		<PasskeyOffer {user} oncontinue={continueToApp} oncreated={finishEnrollment} />
	{:else}
		<div class="flex min-h-96 flex-col justify-center p-6 md:p-8">
			<Field.Group>
				<p role="status" class="text-center text-balance text-muted-foreground">
					<T keyName="auth.passkey_nudge.loading" />
				</p>
				<Field.Field>
					<!-- A plain link, so it continues before hydration and without JavaScript. -->
					<Button href={destinationHref} variant="outline" class="w-full">
						<T keyName="auth.passkey_nudge.continue" />
					</Button>
				</Field.Field>
			</Field.Group>
		</div>
	{/if}
	{#snippet footer()}
		<T keyName="auth.passkey_nudge.about_description" />
		<T keyName="auth.passkey_nudge.manage_before" />
		<a
			href={resolve(localizedHref('/app/settings?tab=security'))}
			class="underline underline-offset-4"><T keyName="auth.passkey_nudge.manage_link" /></a
		><T keyName="auth.passkey_nudge.manage_after" />
	{/snippet}
</AuthPanel>
