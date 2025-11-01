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
	import { toast } from 'svelte-sonner';

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

	let pricingList = {
		free: [
			'10 messages per month',
			'Full source code access',
			'All features included',
			'MIT License'
		],
		pro: [
			'Unlimited messages',
			'Full source code access',
			'All features included',
			'Priority support'
		]
	};

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

	async function handleBillingPortal() {
		const result = await portalOperation.execute({});

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
	<div class="mx-auto max-w-6xl px-6">
		<div class="mx-auto max-w-2xl space-y-6 text-center">
			<h1 class="text-center text-4xl font-semibold lg:text-5xl">Pricing that Scales with You</h1>
			<p class="text-balance">
				This SaaS starter template is completely free and open source.<br />Test the integrated
				payment system powered by Autumn - an open-source billing platform that handles
				subscriptions, usage limits, and Stripe webhooks automatically.
			</p>
		</div>

		<div class="mt-8 grid gap-6 md:mt-20 md:grid-cols-2">
			<Card>
				<CardHeader>
					<CardTitle class="font-medium">
						Free
						{#if isFree}
							<span class="ml-2 text-xs font-normal text-muted-foreground">(Current Plan)</span>
						{/if}
					</CardTitle>

					<span class="my-3 block text-2xl font-semibold">$0 / month</span>

					<CardDescription class="text-sm">Perfect for getting started</CardDescription>
					{#if isFree}
						<Button variant="outline" class="mt-4 w-full" disabled>Current Plan</Button>
					{:else}
						<Button
							variant="outline"
							class="mt-4 w-full"
							onclick={handleBillingPortal}
							disabled={portalOperation.isLoading}
						>
							{portalOperation.isLoading ? 'Loading...' : 'Manage Subscription'}
						</Button>
					{/if}
				</CardHeader>

				<CardContent class="space-y-4">
					<hr class="border-dashed" />

					<ul class="list-outside space-y-3 text-sm">
						{#each pricingList.free as item}
							<li class="flex items-center gap-2">
								<Check class="size-3" />
								{item}
							</li>
						{/each}
					</ul>
				</CardContent>
			</Card>

			<Card class="relative">
				<span
					class="absolute inset-x-0 -top-3 mx-auto flex h-6 w-fit items-center rounded-full bg-linear-to-br/increasing from-purple-400 to-amber-300 px-3 py-1 text-xs font-medium text-amber-950 ring-1 ring-white/20 ring-offset-1 ring-offset-gray-950/5 ring-inset"
					>Popular</span
				>

				<CardHeader>
					<CardTitle class="font-medium">
						Pro
						{#if isPro}
							<span class="ml-2 text-xs font-normal text-muted-foreground">(Current Plan)</span>
						{/if}
					</CardTitle>

					<span class="my-3 block text-2xl font-semibold">$10 / month</span>

					<CardDescription class="text-sm">Unlimited messages and priority support</CardDescription>

					{#if isPro}
						<Button
							variant="outline"
							class="mt-4 w-full"
							onclick={handleBillingPortal}
							disabled={portalOperation.isLoading}
						>
							{portalOperation.isLoading ? 'Loading...' : 'Manage Subscription'}
						</Button>
					{:else}
						<Button
							class="mt-4 w-full"
							onclick={() => handleCheckout('pro')}
							disabled={upgradeOperation.isLoading}
						>
							{upgradeOperation.isLoading ? 'Processing...' : 'Upgrade to Pro'}
						</Button>
					{/if}
				</CardHeader>

				<CardContent class="space-y-4">
					<hr class="border-dashed" />

					<ul class="list-outside space-y-3 text-sm">
						{#each pricingList.pro as item}
							<li class="flex items-center gap-2">
								<Check class="size-3" />
								{item}
							</li>
						{/each}
					</ul>
				</CardContent>
			</Card>
		</div>
	</div>
</section>
