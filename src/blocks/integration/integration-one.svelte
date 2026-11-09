<script lang="ts">
	import IntegrationCard from './card/integration-card.svelte';
	import { Autumn } from '../logos/logos';
	import svelteLogo from '../logos/svelte.svg?no-inline';
	import convexLogo from '../logos/convex.svg?no-inline';
	import betterAuthLogo from '../logos/betterauth.svg?no-inline';
	import stripeLogo from '../logos/stripe.svg?no-inline';
	import tolgeeLogo from '../logos/tolgee.svg?no-inline';
	import postHogLogo from '../logos/posthog.svg?no-inline';
	import shadcnLogo from '../logos/shadcn.svg?no-inline';
	import svBlocksLogo from '../logos/svblocks.svg?no-inline';
	import resendLogo from '../logos/resend.svg?no-inline';
	import sentryLogo from '../logos/sentry.svg?no-inline';
	import { T, getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();
</script>

<section>
	<div class="py-30">
		<div class="mx-auto flex max-w-6xl flex-col px-6 lg:block lg:px-12">
			<div class="text-center lg:text-left">
				<h2 class="text-3xl font-semibold text-balance md:text-4xl">
					<T keyName="integrations.title" />
				</h2>
				<p class="mt-6 text-balance text-muted-foreground">
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
					<img class="size-10" src={svelteLogo} alt="" width="40" height="40" />
				</IntegrationCard>

				<IntegrationCard
					title={$t('integrations.cards.convex.title')}
					description={$t('integrations.cards.convex.description')}
					link="https://convex.dev"
					buttonText={$t('integrations.cards.convex.button')}
				>
					<img class="size-10" src={convexLogo} alt="" width="40" height="40" />
				</IntegrationCard>

				<IntegrationCard
					title={$t('integrations.cards.better_auth.title')}
					description={$t('integrations.cards.better_auth.description')}
					link="https://www.better-auth.com/"
					buttonText={$t('integrations.cards.better_auth.button')}
				>
					<img class="size-10" src={betterAuthLogo} alt="" width="40" height="40" />
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
						<img class="size-10" src={stripeLogo} alt="" width="40" height="40" />
					</div>
				</IntegrationCard>

				<IntegrationCard
					title={$t('integrations.cards.tolgee.title')}
					description={$t('integrations.cards.tolgee.description')}
					link="https://tolgee.io"
					buttonText={$t('integrations.cards.tolgee.button')}
				>
					<img class="size-10" src={tolgeeLogo} alt="" width="40" height="40" />
				</IntegrationCard>

				<IntegrationCard
					title={$t('integrations.cards.posthog.title')}
					description={$t('integrations.cards.posthog.description')}
					link="https://posthog.com/"
					buttonText={$t('integrations.cards.posthog.button')}
				>
					<img class="size-10" src={postHogLogo} alt="" width="40" height="40" />
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
						<img class="size-10 dark:invert" src={shadcnLogo} alt="" width="40" height="40" />
						<img class="size-10 dark:invert" src={svBlocksLogo} alt="" width="40" height="40" />
					</div>
				</IntegrationCard>

				<IntegrationCard
					title={$t('integrations.cards.resend.title')}
					description={$t('integrations.cards.resend.description')}
					link="https://resend.com"
					buttonText={$t('integrations.cards.resend.button')}
				>
					<img class="size-10 dark:invert" src={resendLogo} alt="" width="40" height="40" />
				</IntegrationCard>

				<IntegrationCard
					title={$t('integrations.cards.sentry.title')}
					description={$t('integrations.cards.sentry.description')}
					link="https://sentry.io"
					buttonText={$t('integrations.cards.sentry.button')}
				>
					<img class="size-10 dark:invert" src={sentryLogo} alt="" width="40" height="40" />
				</IntegrationCard>
			</div>
		</div>
	</div>
</section>

<!-- Integration Card Component -->
