<script lang="ts">
	import { Html, Head, Body, Preview, Container } from 'better-svelte-email/components';
	import { Alert, Badge, Button, Card } from '$lib/emails/components/ui/index.js';
	import { EmailHeader, EmailFooter } from '$lib/emails/components/layout/index.js';

	let {
		adminName = 'Support Team',
		messagePreview = 'Thank you for reaching out...',
		deepLink = 'https://example.com?support=open&thread=123'
	}: {
		adminName?: string;
		messagePreview?: string;
		deepLink?: string;
	} = $props();
</script>

<Html>
	<Head />
	<Body class="mx-auto my-auto bg-white px-2 font-sans">
		<Preview preview="{adminName} has replied to your support request" />
		<Container class="mx-auto my-10 max-w-md p-5">
			<Card.Root>
				<EmailHeader />
				<Card.Header>
					<Badge variant="secondary" class="mb-2">Support</Badge>
					<Card.Title>New reply to your request</Card.Title>
					<Card.Description>{adminName} has responded to your support thread</Card.Description>
				</Card.Header>

				<Card.Content>
					<Alert.Root class="mb-4">
						<Alert.Description>"{messagePreview}"</Alert.Description>
					</Alert.Root>

					<Button class="mb-4" href={deepLink}>View Conversation</Button>

					<p class="text-xs text-muted-foreground">
						You're receiving this email because you have an open support request.
					</p>
				</Card.Content>

				<Card.Footer>
					<EmailFooter />
				</Card.Footer>
			</Card.Root>
		</Container>
	</Body>
</Html>
