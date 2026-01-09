<script lang="ts">
	import { Html, Head, Body, Preview, Container } from 'better-svelte-email/components';
	import { Alert, Badge, Button, Card } from '$lib/emails/components/ui/index.js';
	import { EmailHeader, EmailFooter } from '$lib/emails/components/layout/index.js';

	let {
		verificationUrl = 'https://example.com/verify?token=xxx',
		expiryMinutes = 20
	}: {
		verificationUrl?: string;
		expiryMinutes?: number;
	} = $props();
</script>

<Html>
	<Head />
	<Body class="mx-auto my-auto bg-white px-2 font-sans">
		<Preview preview="Verify your email address" />
		<Container class="mx-auto my-10 max-w-md p-5">
			<Card.Root>
				<EmailHeader />
				<Card.Header>
					<Badge variant="secondary" class="mb-2">Auth</Badge>
					<Card.Title>Verify your email</Card.Title>
					<Card.Description>Click the button below to verify your email address</Card.Description>
				</Card.Header>

				<Card.Content>
					<p class="mb-4 text-sm text-foreground">
						Thanks for signing up! Please verify your email address to complete your registration.
					</p>

					<Button class="mb-4" href={verificationUrl}>Verify Email</Button>

					<Alert.Root class="mb-4">
						<Alert.Description>
							This link will expire in {expiryMinutes} minutes.
						</Alert.Description>
					</Alert.Root>

					<p class="text-sm text-muted-foreground">
						If you didn't create an account, please ignore this email.
					</p>
				</Card.Content>

				<Card.Footer>
					<EmailFooter />
				</Card.Footer>
			</Card.Root>
		</Container>
	</Body>
</Html>
