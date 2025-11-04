<script lang="ts">
	import Button from '$lib/components/ui/button/button.svelte';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import Check from '@lucide/svelte/icons/check';
	import { useCustomer, useAutumnOperation } from '@stickerdaniel/convex-autumn-svelte/sveltekit';
	import { useAuth } from '@mmailaender/convex-auth-svelte/sveltekit';
	import { localizedHref } from '$lib/utils/i18n';
	import { useSearchParams } from 'runed/kit';
	import { pricingParamsSchema } from '$lib/schemas/pricing-params';
	import { T, getTranslate } from '@tolgee/svelte';

	const { customer, checkout, openBillingPortal } = useCustomer();
	const upgradeOperation = useAutumnOperation(checkout);
	const portalOperation = useAutumnOperation(openBillingPortal);
	const { isAuthenticated } = useAuth();

	// Get URL params for checkout flow
	const params = useSearchParams(pricingParamsSchema, {
		pushHistory: false // Don't create history entries for param changes
	});

	// Check current subscription status
	const isPro = $derived(customer?.products?.some((p) => p.id === 'pro') ?? false);
	const isFree = $derived(!isPro);

	// Get translation function
	const { t } = getTranslate();

	// Helper function to get non-empty feature keys for a tier
	function getFeatureKeys(tierPath: string): string[] {
		const keys = ['0', '1', '2', '3', '4'];
		return keys.filter((key) => {
			const value = $t(`${tierPath}.${key}`, { orEmpty: true });
			return value && value.trim().length > 0;
		});
	}

	// Get non-empty feature keys for each tier (reactively updates on language change)
	const freeFeatureKeys = $derived(getFeatureKeys('pricing.features.free'));
	const proFeatureKeys = $derived(getFeatureKeys('pricing.features.pro'));
	const enterpriseFeatureKeys = $derived(getFeatureKeys('pricing.features.enterprise'));

	async function handleCheckout(productId: string) {
		console.log('[PRICING DEBUG] handleCheckout called:', { productId, isAuthenticated });

		// Check authentication first
		if (!isAuthenticated) {
			const redirectUrl = localizedHref('/signin');
			const currentUrl = window.location.pathname;
			// Include checkout param in redirectTo so it's preserved after signin
			const redirectWithCheckout = `${currentUrl}?checkout=${productId}`;
			console.log('[PRICING DEBUG] Redirecting to signin:', redirectWithCheckout);
			window.location.href = `${redirectUrl}?redirectTo=${encodeURIComponent(redirectWithCheckout)}`;
			return;
		}

		console.log('[PRICING DEBUG] Executing upgrade operation...');
		// Proceed with checkout for authenticated users
		const result = await upgradeOperation.execute({
			productId,
			successUrl: window.location.origin + '/app/community-chat?upgraded=true'
		});

		console.log('[PRICING DEBUG] Upgrade result:', result);
		if (result?.url) {
			window.location.href = result.url;
		}
	}

	// Auto-trigger checkout after signin if checkout param is present
	$effect(() => {
		console.log('[PRICING DEBUG] Effect running:', {
			checkout: params.checkout,
			isAuthenticated,
			customer: customer ? 'present' : 'null'
		});

		if (params.checkout && isAuthenticated) {
			console.log('[PRICING DEBUG] Triggering checkout for:', params.checkout);
			handleCheckout(params.checkout);
			// Clean up URL param after triggering checkout
			params.checkout = '';
		}
	});
</script>

<section class="py-16 md:py-32">
	<div class="mx-auto max-w-6xl px-6 lg:px-12">
		<div class="mx-auto max-w-2xl space-y-6 text-center">
			<h1 class="text-center text-4xl font-semibold lg:text-5xl">
				<T keyName="pricing.title" />
			</h1>
			<p class="text-balance">
				<T keyName="pricing.description" /><br /><T keyName="pricing.description_autumn" />
			</p>
		</div>

		<div class="mt-8 grid gap-6 md:mt-20 md:grid-cols-2 lg:grid-cols-3">
			<Card>
				<CardHeader>
					<CardTitle class="font-medium">
						<T keyName="pricing.tiers.free.name" />
						{#if isFree}
							<span class="ml-2 text-xs font-normal text-muted-foreground">
								<T keyName="pricing.current_plan_badge" />
							</span>
						{/if}
					</CardTitle>

					<span class="my-3 block text-2xl font-semibold">
						<T keyName="pricing.tiers.free.price" />
					</span>

					<CardDescription class="text-sm">
						<T keyName="pricing.tiers.free.description" />
					</CardDescription>
					{#if isFree}
						<Button variant="outline" class="mt-4 w-full" disabled>
							<T keyName="pricing.tiers.free.button" />
						</Button>
					{:else}
						<Button
							variant="outline"
							class="mt-4 w-full"
							onclick={() => portalOperation.execute({})}
							disabled={portalOperation.isLoading}
						>
							{#if portalOperation.isLoading}
								<T keyName="pricing.buttons.loading" />
							{:else}
								<T keyName="pricing.tiers.free.button_manage" />
							{/if}
						</Button>
					{/if}
				</CardHeader>

				<CardContent class="space-y-4">
					<hr class="border-dashed" />

					<ul class="list-outside space-y-3 text-sm">
						{#each freeFeatureKeys as key}
							<li class="flex items-center gap-2">
								<Check class="size-3" />
								<T keyName="pricing.features.free.{key}" />
							</li>
						{/each}
					</ul>
				</CardContent>
			</Card>

			<Card class="relative">
				<span
					class="absolute inset-x-0 -top-3 mx-auto flex h-6 w-fit items-center rounded-full bg-linear-to-br/increasing from-purple-400 to-amber-300 px-3 py-1 text-xs font-medium text-amber-950 ring-1 ring-white/20 ring-offset-1 ring-offset-gray-950/5 ring-inset"
				>
					<T keyName="pricing.popular_badge" />
				</span>

				<CardHeader>
					<CardTitle class="font-medium">
						<T keyName="pricing.tiers.pro.name" />
						{#if isPro}
							<span class="ml-2 text-xs font-normal text-muted-foreground">
								<T keyName="pricing.current_plan_badge" />
							</span>
						{/if}
					</CardTitle>

					<span class="my-3 block text-2xl font-semibold">
						<T keyName="pricing.tiers.pro.price" />
					</span>

					<CardDescription class="text-sm">
						<T keyName="pricing.tiers.pro.description" />
					</CardDescription>

					{#if isPro}
						<Button
							variant="outline"
							class="mt-4 w-full"
							onclick={() => portalOperation.execute({})}
							disabled={portalOperation.isLoading}
						>
							{#if portalOperation.isLoading}
								<T keyName="pricing.buttons.loading" />
							{:else}
								<T keyName="pricing.tiers.pro.button_manage" />
							{/if}
						</Button>
					{:else}
						<Button
							class="mt-4 w-full"
							onclick={() => handleCheckout('pro')}
							disabled={upgradeOperation.isLoading}
						>
							{#if upgradeOperation.isLoading}
								<T keyName="pricing.tiers.pro.button_loading" />
							{:else}
								<T keyName="pricing.tiers.pro.button" />
							{/if}
						</Button>
					{/if}
				</CardHeader>

				<CardContent class="space-y-4">
					<hr class="border-dashed" />

					<ul class="list-outside space-y-3 text-sm">
						{#each proFeatureKeys as key}
							<li class="flex items-center gap-2">
								<Check class="size-3" />
								<T keyName="pricing.features.pro.{key}" />
							</li>
						{/each}
					</ul>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle class="font-medium">
						<T keyName="pricing.tiers.enterprise.name" />
					</CardTitle>

					<span class="my-3 block text-2xl font-semibold">
						<T keyName="pricing.tiers.enterprise.price" />
					</span>

					<CardDescription class="text-sm">
						<T keyName="pricing.tiers.enterprise.description" />
					</CardDescription>

					<Button variant="outline" class="mt-4 w-full" href="mailto:sales@example.com">
						<T keyName="pricing.tiers.enterprise.button" />
					</Button>
				</CardHeader>

				<CardContent class="space-y-4">
					<hr class="border-dashed" />

					<ul class="list-outside space-y-3 text-sm">
						{#each enterpriseFeatureKeys as key}
							<li class="flex items-center gap-2">
								<Check class="size-3" />
								<T keyName="pricing.features.enterprise.{key}" />
							</li>
						{/each}
					</ul>
				</CardContent>
			</Card>
		</div>
	</div>
</section>
