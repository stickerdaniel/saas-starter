<script lang="ts">
	import { Html, Body, Preview, Container } from '@better-svelte-email/components';
	import { Badge, Button, Card } from '$lib/emails/components/ui/index.js';
	import { EmailHead, EmailHeader, EmailFooter } from '$lib/emails/components/layout/index.js';

	// All user-facing copy is passed in as props so the caller can resolve
	// translated strings (see src/lib/convex/emails/templates.ts). English
	// defaults keep the build-time preview rendering.
	let {
		lang = 'en',
		userName = 'New User',
		userEmail = 'user@example.com',
		signupMethod = 'Email',
		signupTime = 'Jan 15, 2026 at 3:45 PM',
		adminDashboardLink = 'https://example.com/admin/users',
		badgeText = 'Stats',
		titleText = 'New user signed up',
		descriptionText = 'A new user has registered on your platform',
		previewText = 'New user: user@example.com',
		nameLabel = 'Name:',
		emailLabel = 'Email:',
		methodLabel = 'Method:',
		timeLabel = 'Time:',
		buttonText = 'View in Admin Dashboard',
		footerText = "You're receiving this email because you have new signup notifications enabled."
	}: {
		lang?: string;
		userName?: string;
		userEmail?: string;
		signupMethod?: string;
		signupTime?: string;
		adminDashboardLink?: string;
		badgeText?: string;
		titleText?: string;
		descriptionText?: string;
		previewText?: string;
		nameLabel?: string;
		emailLabel?: string;
		methodLabel?: string;
		timeLabel?: string;
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
						The dark: colours have to be repeated here. This badge overrides the
						default variant's light fill, but tailwind-merge keeps `bg-*` and
						`dark:bg-*` in separate groups, so the variant's dark:bg-zinc-200 would
						survive and turn the blue badge grey in dark mode. Blue 600 carries on
						both schemes, so it stays in both.
					-->
					<Badge
						class="mb-2 border-transparent bg-blue-600 text-white dark:bg-blue-600 dark:text-white"
						>{badgeText}</Badge
					>
					<Card.Title>{titleText}</Card.Title>
					<Card.Description>{descriptionText}</Card.Description>
				</Card.Header>

				<Card.Content>
					<!--
						Tailwind classes rather than an inline background, because an inline
						style cannot carry a dark: variant and the box would stay light on
						the dark card. bg-zinc-100 is the #f4f4f5 this used to hardcode.
					-->
					<div class="mb-4 rounded-md bg-zinc-100 p-4 dark:bg-zinc-800">
						<p style="margin: 0 0 8px 0; font-size: 14px;">
							<strong>{nameLabel}</strong>
							{userName}
						</p>
						<p style="margin: 0 0 8px 0; font-size: 14px;">
							<strong>{emailLabel}</strong>
							{userEmail}
						</p>
						<p style="margin: 0 0 8px 0; font-size: 14px;">
							<strong>{methodLabel}</strong>
							{signupMethod}
						</p>
						<p style="margin: 0; font-size: 14px;">
							<strong>{timeLabel}</strong>
							{signupTime}
						</p>
					</div>

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
