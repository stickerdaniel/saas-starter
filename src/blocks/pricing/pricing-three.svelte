<script>
	import Button from '$lib/components/ui/button/button.svelte';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import Check from '@lucide/svelte/icons/check';
	let pricingList = {
		free: ['Full source code access', 'All features included', 'MIT License', 'Community support'],
		startup: [
			'Test one-time payment flow',
			'Use test card: 4242 4242 4242 4242',
			'No real charges'
		],
		pro: [
			'Test subscription flow',
			'Try cancellation flow',
			'Use test card: 4242 4242 4242 4242',
			'No real charges'
		]
	};
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

		<div class="mt-8 grid gap-6 md:mt-20 md:grid-cols-3">
			<Card>
				<CardHeader>
					<CardTitle class="font-medium">Starter</CardTitle>

					<span class="my-3 block text-2xl font-semibold">$0 / mo</span>

					<CardDescription class="text-sm">Forever free</CardDescription>
					<Button variant="outline" class="mt-4 w-full">
						<a href="">Get Started</a>
					</Button>
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
					<CardTitle class="font-medium">Subscription</CardTitle>

					<span class="my-3 block text-2xl font-semibold">$19 / mo</span>

					<CardDescription class="text-sm">Test mode - No real charge</CardDescription>

					<Button class="mt-4 w-full">
						<a href="">Test Subscription - $19/mo</a>
					</Button>
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

			<Card class="flex flex-col">
				<CardHeader>
					<CardTitle class="font-medium">One-time Payment</CardTitle>

					<span class="my-3 block text-2xl font-semibold">$49</span>

					<CardDescription class="text-sm">Test mode - No real charge</CardDescription>

					<Button variant="outline" class="mt-4 w-full">
						<a href="">Test Payment - $49</a>
					</Button>
				</CardHeader>

				<CardContent class="space-y-4">
					<hr class="border-dashed" />

					<ul class="list-outside space-y-3 text-sm">
						{#each pricingList.startup as item}
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
