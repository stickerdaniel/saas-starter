<script lang="ts">
	import { onDestroy } from 'svelte';
	import SEOHead from '#lib/components/SEOHead.svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { useConvexClient } from 'convex-svelte';
	import { useSearchParams } from 'runed/kit';
	import { claimPasskeyNudge, type PasskeyNudgeUser } from '#lib/utils/passkey-nudge.js';
	import { redirectParamsSchema } from '#lib/schemas/auth.js';
	import { localizedHref } from '#lib/utils/i18n.js';
	import { safeAuthDestination } from '#lib/utils/url.js';
	import AuthPanel from '#lib/components/auth/auth-panel.svelte';
	import PasskeyOfferPanel from '#lib/components/auth/passkey-offer-panel.svelte';
	import { morphAuthCard } from '#lib/components/auth/auth-card-morph.js';
	import {
		continueAfterEnrollment,
		skipToDestination
	} from '#lib/components/auth/passkey-offer-navigation.js';
	import Logo from '#lib/components/icons/logo.svelte';
	import { LoadingBar } from '#lib/components/ui/loading-bar/index.js';
	import { T, getTranslate } from '@tolgee/svelte';

	const auth = useAuth();
	const client = useConvexClient();
	const { t } = getTranslate();
	const params = useSearchParams(redirectParamsSchema, {
		debounce: 300,
		pushHistory: false
	});

	let pageLoadTime = Date.now();
	/** Set once this page has shown the passkey offer or moved on, which ends the fallback. */
	let settled = $state(false);
	let passkeyOffer = $state<PasskeyNudgeUser | null>(null);
	let checking = false;
	let destroyed = false;
	onDestroy(() => {
		destroyed = true;
	});
	const destination = $derived(safeAuthDestination(params.redirectTo, localizedHref('/app')));
	const verifiedDescription = $derived(
		$t('auth.verification.verified_description').replace(/\. /u, '.\n')
	);

	// Once authenticated, decide on the passkey offer behind this confirmation, which stays up
	// for at least 1.5s. An account that gets the offer sees it in this card.
	$effect(() => {
		if (auth.isLoading || !auth.isAuthenticated || checking) return;
		checking = true;

		const minimumDisplay = new Promise((resolve) =>
			setTimeout(resolve, Math.max(0, 1500 - (Date.now() - pageLoadTime)))
		);
		void Promise.all([claimPasskeyNudge(client), minimumDisplay]).then(([offer]) => {
			if (destroyed) return;
			settled = true;
			if (offer) morphAuthCard(() => (passkeyOffer = offer));
			else window.location.href = destination;
		});
	});

	// Fallback: redirect to signin if auth has settled but user is not authenticated after 10s
	$effect(() => {
		if (settled) return;

		const timeoutId = setTimeout(() => {
			if (!auth.isLoading && !auth.isAuthenticated) {
				const signinUrl = `${localizedHref('/signin')}?redirectTo=${encodeURIComponent(destination)}`;
				window.location.href = signinUrl;
			}
		}, 10000);

		return () => clearTimeout(timeoutId);
	});
</script>

<SEOHead
	title={$t('meta.auth.email_verified.title')}
	description={$t('meta.auth.email_verified.description')}
	noindex
/>

{#if passkeyOffer}
	<PasskeyOfferPanel
		user={passkeyOffer}
		oncontinue={() => skipToDestination(destination)}
		oncreated={() => void continueAfterEnrollment(destination)}
	/>
{:else}
	<AuthPanel transition>
		<div class="min-h-96">
			<LoadingBar mode="loading" showBackground={false} variant="edge" />
			<div class="p-6 md:p-8">
				<Logo class="mb-6 block size-6" />
				<div class="flex flex-col gap-2">
					<h1 class="text-2xl font-bold">
						<T keyName="auth.verification.verified_title" />
					</h1>
					<p class="text-balance whitespace-pre-line text-muted-foreground">
						{verifiedDescription}
					</p>
				</div>
			</div>
		</div>
	</AuthPanel>
{/if}
