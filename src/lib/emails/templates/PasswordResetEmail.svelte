<script lang="ts">
	import { Html, Head, Body, Preview, Container } from 'better-svelte-email/components';
	import { Alert, Badge, Button, Card } from '$lib/emails/components/ui/index.js';
	import { EmailHeader, EmailFooter } from '$lib/emails/components/layout/index.js';

	let {
		resetUrl = 'https://example.com/reset?token=xxx',
		userName = ''
	}: {
		resetUrl?: string;
		userName?: string;
	} = $props();

	// svelte-ignore state_referenced_locally
	const greeting = userName ? `Hey ${userName}` : 'Hey';
</script>

<Html>
	<Head />
	<Body class="mx-auto my-auto bg-white px-2 font-sans">
		<Preview preview="Reset your password" />
		<Container class="mx-auto my-10 max-w-md p-5">
			<Card.Root>
				<EmailHeader />
				<Card.Header>
					<Badge variant="secondary" class="mb-2">Auth</Badge>
					<Card.Title>Reset your password</Card.Title>
					<Card.Description>{greeting},</Card.Description>
				</Card.Header>

				<Card.Content>
					<p class="mb-4 text-sm text-foreground">
						We received a request to reset your password. Click the button below to set a new
						password:
					</p>

					<Button class="mb-4" href={resetUrl}>Reset Password</Button>

					<Alert.Root class="mb-4">
						<Alert.Description>
							This link will expire in 1 hour for security reasons.
						</Alert.Description>
					</Alert.Root>

					<p class="text-sm text-muted-foreground">
						If you didn't request this, you can safely ignore this email. Your password will remain
						unchanged.
					</p>
				</Card.Content>

				<Card.Footer>
					<EmailFooter />
				</Card.Footer>
			</Card.Root>
		</Container>
	</Body>
</Html>
