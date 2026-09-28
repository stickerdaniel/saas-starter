<script lang="ts">
	import { Html, Body, Preview, Container } from '@better-svelte-email/components';
	import { Badge, Button, Card } from '$lib/emails/components/ui/index.js';
	import { EmailHead, EmailHeader, EmailFooter } from '$lib/emails/components/layout/index.js';

	// All user-facing copy is passed in as props so the caller can resolve
	// translated strings (see src/lib/convex/emails/templates.ts). English
	// defaults keep the build-time preview rendering.
	let {
		lang = 'en',
		adminDashboardLink = 'https://example.com/admin/support',
		badgeText = 'Alert',
		titleText = 'Support rate limit running low',
		descriptionText = 'New conversations from signed-out visitors have used 87% of their shared limit for at least 10 minutes.',
		previewText = 'New conversations: 4 of 30 left',
		limitLabel = 'Limit:',
		limitName = 'New conversations',
		remainingLabel = 'Remaining:',
		remainingText = '4 of 30',
		refillLabel = 'Refill:',
		refillText = '100 per hour',
		impactText = 'When it runs out, signed-out visitors see a rate limit error in the support widget.',
		actionText = 'If this is real traffic, raise the limit in the support rate limiter configuration. If it comes from a single source, it may be abuse.',
		buttonText = 'View in Admin Dashboard',
		footerText = "You're receiving this email because you have new support ticket notifications enabled. Each limit sends at most one alert every 6 hours."
	}: {
		lang?: string;
		adminDashboardLink?: string;
		badgeText?: string;
		titleText?: string;
		descriptionText?: string;
		previewText?: string;
		limitLabel?: string;
		limitName?: string;
		remainingLabel?: string;
		remainingText?: string;
		refillLabel?: string;
		refillText?: string;
		impactText?: string;
		actionText?: string;
		buttonText?: string;
		footerText?: string;
	} = $props();
</script>

<Html {lang}>
	<EmailHead />
	<Body class="mx-auto my-auto bg-white px-2 font-sans dark:bg-zinc-950">
		<Preview preview={previewText} />
		<Container class="mx-auto my-10 max-w-md p-5">
			<Card.Root>
				<EmailHeader />
				<Card.Header>
					<!--
						The dark: colours are repeated for the same reason as the signup
						badge: tailwind-merge keeps `bg-*` and `dark:bg-*` apart, so the
						default variant's dark fill would otherwise survive. Amber 700
						keeps white text readable in both schemes.
					-->
					<Badge
						class="mb-2 border-transparent bg-amber-700 text-white dark:bg-amber-700 dark:text-white"
						>{badgeText}</Badge
					>
					<Card.Title>{titleText}</Card.Title>
					<Card.Description>{descriptionText}</Card.Description>
				</Card.Header>

				<Card.Content>
					<div class="mb-4 rounded-md bg-zinc-100 p-4 dark:bg-zinc-800">
						<p style="margin: 0 0 8px 0; font-size: 14px;">
							<strong>{limitLabel}</strong>
							{limitName}
						</p>
						<p style="margin: 0 0 8px 0; font-size: 14px;">
							<strong>{remainingLabel}</strong>
							{remainingText}
						</p>
						<p style="margin: 0; font-size: 14px;">
							<strong>{refillLabel}</strong>
							{refillText}
						</p>
					</div>

					<p class="mb-2 text-sm">{impactText}</p>
					<p class="mb-4 text-sm">{actionText}</p>

					<Button class="mb-4" href={adminDashboardLink}>{buttonText}</Button>

					<p class="text-xs text-muted-foreground dark:text-zinc-400">
						{footerText}
					</p>
				</Card.Content>

				<Card.Footer>
					<EmailFooter />
				</Card.Footer>
			</Card.Root>
		</Container>
	</Body>
</Html>
