<script lang="ts">
	// Scroll below for the component code
	import IntegrationCard from './card/integration-card.svelte';
	import { Svelte, Convex, Tolgee, PostHog, SVBlocks, Autumn } from '../logos/logos';
	import Shadcn from '../logos/Shadcn.svelte';
	import Stripe from '../logos/Stripe.svelte';
	import { Plus } from '@lucide/svelte';
</script>

<section>
	<div class="py-24">
		<div class="mx-auto flex max-w-7xl flex-col px-6 lg:block lg:px-12">
			<div class="text-left">
				<h2 class="text-3xl font-semibold text-balance md:text-4xl">
					Real 2025 Developer Experience
				</h2>
				<p class="mt-6 text-muted-foreground">
					Super fast solutions that are actually fun to build with
				</p>
			</div>
			<div class="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
				<IntegrationCard
					title="Svelte 5"
					description="The most loved frontend framework. A simple, performant, and future-proof way to build your web app."
					link="https://svelte.dev"
				>
					<Svelte />
				</IntegrationCard>

				<IntegrationCard
					title="Convex"
					description="The open source Firebase alternative. Built on PostgreSQL - world's most advanced relational database."
					link="https://convex.dev"
				>
					<Convex />
				</IntegrationCard>

				<IntegrationCard
					title="Tolgee"
					description="Internationalization done right. In-context editing and ML-powered translation for a seamless localization workflow."
					link="https://tolgee.io"
				>
					<Tolgee />
				</IntegrationCard>

				<IntegrationCard
					title="PostHog"
					description="PostHog is an open-source product analytics platform to track user behavior and measure conversions."
					link="https://posthog.com/"
				>
					<PostHog />
				</IntegrationCard>

				<IntegrationCard
					title="Shadcn Svelte + SVBlocks"
					description="A set of beautifully-designed, accessible components built with Tailwind CSS v4 and Bits UI."
					link="https://next.shadcn-svelte.com/"
					secondaryLink="https://sv-blocks.vercel.app/"
					secondaryTitle="SVBlocks"
				>
					<div class="flex items-center gap-2">
						<Shadcn class="size-10" />
						<SVBlocks class="size-10" />
					</div>
				</IntegrationCard>

				<IntegrationCard
					title="Autumn + Stripe"
					description="Autumn handles billing, feature gates, and usage tracking—no webhook complexity. Stripe for payment processing."
					link="https://useautumn.com/"
					secondaryLink="https://stripe.com"
					secondaryTitle="Stripe"
				>
					<div class="flex items-center gap-2">
						<Autumn class="size-10" />
						<Stripe class="size-10" />
					</div>
				</IntegrationCard>
			</div>
		</div>
	</div>
</section>

<!-- Integration Card Component -->
