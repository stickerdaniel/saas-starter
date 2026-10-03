<script lang="ts">
	import { onDestroy } from 'svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { useConvexClient } from 'convex-svelte';
	import { resolve } from '$app/paths';
	import { T, getTranslate } from '@tolgee/svelte';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import * as Card from '$lib/components/ui/card';
	import * as Field from '$lib/components/ui/field';
	import { Button } from '$lib/components/ui/button';
	import PasskeyOffer from '$lib/components/auth/passkey-offer.svelte';
	import { claimPasskeyNudge, type PasskeyNudgeUser } from '$lib/utils/passkey-nudge';

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
	function continueToApp() {
		window.location.replace(data.destination);
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

<div class="flex min-h-svh flex-col items-center justify-center p-6 md:p-10">
	<div class="flex w-full max-w-sm flex-col gap-6 md:max-w-3xl">
		<Card.Root class="overflow-hidden p-0">
			<Card.Content class="grid p-0 md:grid-cols-2">
				{#if user}
					<PasskeyOffer {user} oncontinue={continueToApp} />
				{:else}
					<div class="min-h-96 p-6 md:p-8">
						<Field.Group>
							<p role="status" class="text-center text-balance text-muted-foreground">
								<T keyName="auth.passkey_nudge.loading" />
							</p>
							<Field.Field>
								<!-- A plain link, so it continues before hydration and without JavaScript. -->
								<Button href={resolve(data.destination)} variant="outline" class="w-full">
									<T keyName="auth.passkey_nudge.continue" />
								</Button>
							</Field.Field>
						</Field.Group>
					</div>
				{/if}
				<div class="relative hidden bg-muted md:block">
					<img
						src="/placeholder.svg"
						alt=""
						draggable="false"
						class="absolute inset-0 h-full w-full object-cover select-none dark:brightness-20 dark:grayscale"
					/>
				</div>
			</Card.Content>
		</Card.Root>
		<Field.Description class="px-6 text-center text-balance">
			<T keyName="auth.passkey_nudge.about_description" />
		</Field.Description>
	</div>
</div>
