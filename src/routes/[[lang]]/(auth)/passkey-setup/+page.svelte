<script lang="ts">
	import { onDestroy } from 'svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { useConvexClient } from 'convex-svelte';
	import { T, getTranslate } from '@tolgee/svelte';
	import SEOHead from '#lib/components/SEOHead.svelte';
	import AuthPanel from '#lib/components/auth/auth-panel.svelte';
	import Logo from '#lib/components/icons/logo.svelte';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import PasskeyOfferPanel from '#lib/components/auth/passkey-offer-panel.svelte';
	import { morphAuthCard } from '#lib/components/auth/auth-card-morph.js';
	import {
		continueAfterEnrollment,
		destinationHref,
		skipToDestination
	} from '#lib/components/auth/passkey-offer-navigation.js';
	import { claimPasskeyNudge, type PasskeyNudgeUser } from '#lib/utils/passkey-nudge.js';

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

	$effect(() => {
		if (auth.isLoading || !auth.isAuthenticated || started) return;
		started = true;
		void claimPasskeyNudge(client).then((eligible) => {
			if (destroyed) return;
			if (eligible) morphAuthCard(() => (user = eligible));
			else skipToDestination(data.destination);
		});
	});
</script>

<SEOHead
	title={$t('auth.passkey_nudge.title')}
	description={$t('auth.passkey_nudge.description')}
	noindex
/>

{#if user}
	<PasskeyOfferPanel
		{user}
		oncontinue={() => skipToDestination(data.destination)}
		oncreated={() => void continueAfterEnrollment(data.destination)}
	/>
{:else}
	<AuthPanel transition>
		<div class="min-h-96">
			<!-- The room the offer's edge loading bar takes, so the content lines up
			     with the offer that replaces it. -->
			<div class="h-1"></div>
			<div class="p-6 md:p-8">
				<Logo class="mb-6 block size-6" />
				<Field.Group>
					<p role="status" class="text-balance text-muted-foreground">
						<T keyName="auth.passkey_nudge.loading" />
					</p>
					<Field.Field>
						<!-- A plain link, so it continues before hydration and without JavaScript. -->
						<Button href={destinationHref(data.destination)} variant="outline" class="w-full">
							<T keyName="auth.passkey_nudge.continue" />
						</Button>
					</Field.Field>
				</Field.Group>
			</div>
		</div>
	</AuthPanel>
{/if}
