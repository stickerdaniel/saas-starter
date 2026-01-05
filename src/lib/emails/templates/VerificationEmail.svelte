<script lang="ts">
	import { Html, Head, Body, Preview, Container } from 'better-svelte-email/components';
	import { Alert, Badge, Card } from '$lib/emails/components/ui/index.js';
	import { EmailHeader, EmailFooter } from '$lib/emails/components/layout/index.js';

	let {
		code = '12345678',
		expiryMinutes = 20
	}: {
		code?: string;
		expiryMinutes?: number;
	} = $props();
</script>

<Html>
	<Head />
	<Preview preview="Your verification code is {code}" />
	<Body class="mx-auto my-auto bg-white px-2 font-sans">
		<Container class="mx-auto my-10 max-w-md p-5">
			<Card.Root>
				<EmailHeader />
				<Card.Header>
					<Badge variant="secondary" class="mb-2">Auth</Badge>
					<Card.Title>Verify your email</Card.Title>
					<Card.Description>Enter this code to complete your verification</Card.Description>
				</Card.Header>

				<Card.Content>
					<div class="mb-7 py-6 text-center">
						<p class="font-mono text-3xl font-bold tracking-widest text-foreground">{code}</p>
					</div>

					<Alert.Root class="mb-4">
						<Alert.Description>
							This code will expire in {expiryMinutes} minutes.
						</Alert.Description>
					</Alert.Root>

					<p class="text-sm text-muted-foreground">
						If you didn't request this code, please ignore this email.
					</p>
				</Card.Content>

				<Card.Footer>
					<EmailFooter />
				</Card.Footer>
			</Card.Root>
		</Container>
	</Body>
</Html>
