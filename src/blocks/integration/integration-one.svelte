<script lang="ts">
	import IntegrationCard from './card/integration-card.svelte';
	import {
		Svelte,
		Convex,
		Tolgee,
		PostHog,
		SVBlocks,
		Autumn,
		BetterAuth,
		Resend,
		Sentry
	} from '../logos/logos';
	import Shadcn from '../logos/Shadcn.svelte';
	import Stripe from '../logos/Stripe.svelte';
	import { T, getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();
</script>

<section>
	<div class="py-30">
		<div class="mx-auto flex max-w-6xl flex-col px-6 lg:block lg:px-12">
			<div class="text-center lg:text-left">
				<h2 class="text-3xl font-semibold text-balance md:text-4xl">
					<T keyName="integrations.title" params={{ year: new Date().getFullYear() }} />
				</h2>
				<p class="mt-6 text-muted-foreground">
					<T keyName="integrations.description" />
				</p>
			</div>
			<div class="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
				<IntegrationCard
					title={$t('integrations.cards.svelte.title')}
					description={$t('integrations.cards.svelte.description')}
					link="https://svelte.dev"
					buttonText={$t('integrations.cards.svelte.button')}
				>
					<Svelte />
				</IntegrationCard>

				<IntegrationCard
					title={$t('integrations.cards.convex.title')}
					description={$t('integrations.cards.convex.description')}
					link="https://convex.dev"
					buttonText={$t('integrations.cards.convex.button')}
				>
					<Convex />
				</IntegrationCard>

				<IntegrationCard
					title={$t('integrations.cards.better_auth.title')}
					description={$t('integrations.cards.better_auth.description')}
					link="https://www.better-auth.com/"
					buttonText={$t('integrations.cards.better_auth.button')}
				>
					<BetterAuth />
				</IntegrationCard>

				<IntegrationCard
					title={$t('integrations.cards.autumn_stripe.title')}
					description={$t('integrations.cards.autumn_stripe.description')}
					link="https://useautumn.com/"
					secondaryLink="https://stripe.com"
					secondaryTitle={$t('integrations.cards.autumn_stripe.secondary_title')}
					buttonText={$t('integrations.cards.autumn_stripe.button')}
					secondaryButtonText={$t('integrations.cards.autumn_stripe.secondary_button')}
				>
					<div class="flex items-center gap-2">
						<Autumn class="size-10" />
						<Stripe class="size-10" />
					</div>
				</IntegrationCard>

				<IntegrationCard
					title={$t('integrations.cards.tolgee.title')}
					description={$t('integrations.cards.tolgee.description')}
					link="https://tolgee.io"
					buttonText={$t('integrations.cards.tolgee.button')}
				>
					<Tolgee />
				</IntegrationCard>

				<IntegrationCard
					title={$t('integrations.cards.posthog.title')}
					description={$t('integrations.cards.posthog.description')}
					link="https://posthog.com/"
					buttonText={$t('integrations.cards.posthog.button')}
				>
					<PostHog />
				</IntegrationCard>

				<IntegrationCard
					title={$t('integrations.cards.shadcn_svblocks.title')}
					description={$t('integrations.cards.shadcn_svblocks.description')}
					link="https://next.shadcn-svelte.com/"
					secondaryLink="https://sv-blocks.vercel.app/"
					secondaryTitle={$t('integrations.cards.shadcn_svblocks.secondary_title')}
					buttonText={$t('integrations.cards.shadcn_svblocks.button')}
					secondaryButtonText={$t('integrations.cards.shadcn_svblocks.secondary_button')}
				>
					<div class="flex items-center gap-2">
						<Shadcn class="size-10" />
						<SVBlocks class="size-10" />
					</div>
				</IntegrationCard>

				<IntegrationCard
					title={$t('integrations.cards.resend.title')}
					description={$t('integrations.cards.resend.description')}
					link="https://resend.com"
					buttonText={$t('integrations.cards.resend.button')}
				>
					<Resend />
				</IntegrationCard>

				<IntegrationCard
					title={$t('integrations.cards.sentry.title')}
					description={$t('integrations.cards.sentry.description')}
					link="https://sentry.io"
					buttonText={$t('integrations.cards.sentry.button')}
				>
					<Sentry />
				</IntegrationCard>
			</div>
		</div>
	</div>
</section>

<!-- Integration Card Component -->
