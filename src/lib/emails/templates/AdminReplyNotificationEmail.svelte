<script lang="ts">
	import { Html, Head, Body, Preview, Container } from '@better-svelte-email/components';
	import { Alert, Badge, Button, Card } from '$lib/emails/components/ui/index.js';
	import { EmailHeader, EmailFooter } from '$lib/emails/components/layout/index.js';

	// All user-facing copy is passed in as props so the caller can resolve
	// translated strings (see src/lib/convex/emails/templates.ts). English
	// defaults keep the build-time preview rendering.
	let {
		lang = 'en',
		messagePreview = 'Thank you for reaching out...',
		deepLink = 'https://example.com?support=open&thread=123',
		badgeText = 'Support',
		titleText = 'New reply to your request',
		descriptionText = 'Support Team has responded to your support thread',
		previewText = 'Support Team has replied to your support request',
		buttonText = 'View Conversation',
		footerText = "You're receiving this email because you have an open support request."
	}: {
		lang?: string;
		messagePreview?: string;
		deepLink?: string;
		badgeText?: string;
		titleText?: string;
		descriptionText?: string;
		previewText?: string;
		buttonText?: string;
		footerText?: string;
	} = $props();
</script>

<Html {lang}>
	<Head />
	<Body class="mx-auto my-auto bg-white px-2 font-sans">
		<Preview preview={previewText} />
		<Container class="mx-auto my-10 max-w-md p-5">
			<Card.Root>
				<EmailHeader />
				<Card.Header>
					<Badge variant="secondary" class="mb-2">{badgeText}</Badge>
					<Card.Title>{titleText}</Card.Title>
					<Card.Description>{descriptionText}</Card.Description>
				</Card.Header>

				<Card.Content>
					<Alert.Root class="mb-4">
						<Alert.Description>"{messagePreview}"</Alert.Description>
					</Alert.Root>

					<Button class="mb-4" href={deepLink}>{buttonText}</Button>

					<p class="text-xs text-muted-foreground">
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
