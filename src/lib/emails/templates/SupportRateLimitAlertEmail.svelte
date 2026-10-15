<script lang="ts">
	import { Html, Body, Preview, Container, Row, Column } from '@better-svelte-email/components';
	import { Badge, Button, Card } from '#lib/emails/components/ui/index.js';
	import { EmailHead, EmailHeader, EmailFooter } from '#lib/emails/components/layout/index.js';

	// All user-facing copy is passed in as props so the caller can resolve
	// translated strings (see src/lib/convex/emails/templates.ts). English
	// defaults keep the build-time preview rendering. The two meter widths are
	// whole percents the caller computes from the sampled level, not from copy.
	let {
		lang = 'en',
		adminDashboardLink = 'https://example.com/admin/support',
		badgeText = 'Alert',
		titleText = 'Support rate limit running low',
		descriptionText = 'Signed-out visitors share this limit. It has been low for at least 10 minutes.',
		previewText = 'New conversations: 4 of 30 left',
		limitName = 'New conversations',
		availableText = '4',
		remainingText = 'of 30 left',
		usedPercent = '87',
		unusedPercent = '13',
		usedText = '87% used',
		refillText = 'Refills 100 per hour',
		impactText = 'At zero the support widget shows signed-out visitors a rate limit error. Raise the limit for real traffic; a single source may be abuse.',
		buttonText = 'View in Admin Dashboard',
		footerText = "You're receiving this email because you have new support ticket notifications enabled. Each limit sends at most one alert every 6 hours."
	}: {
		lang?: string;
		adminDashboardLink?: string;
		badgeText?: string;
		titleText?: string;
		descriptionText?: string;
		previewText?: string;
		limitName?: string;
		availableText?: string;
		remainingText?: string;
		usedPercent?: string;
		unusedPercent?: string;
		usedText?: string;
		refillText?: string;
		impactText?: string;
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
					<div class="mb-5 rounded-md border border-border p-4 dark:border-zinc-800">
						<p class="m-0 text-xs text-muted-foreground dark:text-zinc-400">{limitName}</p>
						<p class="m-0 mt-1 text-3xl leading-none font-semibold">
							{availableText}
							<span class="text-sm font-normal text-muted-foreground dark:text-zinc-400"
								>{remainingText}</span
							>
						</p>
						<!--
							The meter is two filled cells sized by both the width attribute and
							style, because mail clients drop gradients, flexbox and positioned
							bars. The non-breaking space, set at font-size 0 so it adds no height,
							keeps a client that collapses empty cells from flattening the bar.
							data-meter lets tests find it.
						-->
						<Row
							data-meter
							class="mt-3 border-separate border-spacing-0 overflow-hidden rounded-full"
						>
							<Column
								width={`${usedPercent}%`}
								height="8"
								class="h-2 bg-amber-600 p-0 leading-0"
								style={`width:${usedPercent}%;font-size:0`}>&nbsp;</Column
							>
							<Column
								width={`${unusedPercent}%`}
								height="8"
								class="h-2 bg-zinc-200 p-0 leading-0 dark:bg-zinc-800"
								style={`width:${unusedPercent}%;font-size:0`}>&nbsp;</Column
							>
						</Row>
						<Row class="mt-2">
							<Column class="align-top text-xs text-muted-foreground dark:text-zinc-400"
								>{usedText}</Column
							>
							<Column
								align="right"
								class="text-right align-top text-xs text-muted-foreground dark:text-zinc-400"
								>{refillText}</Column
							>
						</Row>
					</div>

					<p class="mb-4 text-sm">{impactText}</p>

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
