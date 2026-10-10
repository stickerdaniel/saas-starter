<script lang="ts">
	import { Html, Body, Preview, Container } from '@better-svelte-email/components';
	import { Badge, Button, Card } from '#lib/emails/components/ui/index.js';
	import { EmailHead, EmailHeader, EmailFooter } from '#lib/emails/components/layout/index.js';
	import { JOURNEY_DARK_UTILITIES } from '#lib/convex/admin/journey/theme.js';

	// All user-facing copy is passed in as props so the caller can resolve
	// translated strings (see src/lib/convex/emails/templates.ts). English
	// defaults keep the build-time preview rendering. `timelineHtml` is the
	// journey (tiles, rail and notes), built per recipient with inline colours.
	let {
		lang = 'en',
		badgeText = 'New customer',
		titleText = 'Ada Lovelace paid $10.00',
		descriptionText = 'ada@example.com',
		previewText = '14 AI chat messages before paying',
		timelineHtml = '<p>Customer journey</p>',
		adminDashboardLink = 'https://example.com/admin/users',
		buttonText = 'View in Admin Dashboard',
		footerText = "Times in UTC. You're receiving this email because you have new customer notifications enabled."
	}: {
		lang?: string;
		badgeText?: string;
		titleText?: string;
		descriptionText?: string;
		previewText?: string;
		timelineHtml?: string;
		adminDashboardLink?: string;
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
					<!-- The dark: colours are repeated for the reason given in NewUserSignupNotificationEmail. -->
					<Badge
						class="mb-2 border-transparent bg-blue-600 text-white dark:bg-blue-600 dark:text-white"
						>{badgeText}</Badge
					>
					<Card.Title>{titleText}</Card.Title>
					<Card.Description>{descriptionText}</Card.Description>
				</Card.Header>

				<Card.Content>
					<!--
						The journey carries the theme's dark classes but no utilities, and the
						renderer writes a dark rule only for a utility it sees. This hidden
						element makes it write one for each.
					-->
					<div class={['hidden', ...JOURNEY_DARK_UTILITIES].join(' ')}></div>

					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					{@html timelineHtml}

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
