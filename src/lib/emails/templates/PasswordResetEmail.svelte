<script lang="ts">
	import { Html, Head, Body, Preview, Container } from '@better-svelte-email/components';
	import { Alert, Badge, Button, Card } from '$lib/emails/components/ui/index.js';
	import { EmailHeader, EmailFooter } from '$lib/emails/components/layout/index.js';

	// All user-facing copy is passed in as props so the caller can resolve
	// translated strings (see src/lib/convex/emails/templates.ts). English
	// defaults keep the build-time preview rendering.
	let {
		resetUrl = 'https://example.com/reset?token=xxx',
		badgeText = 'Auth',
		titleText = 'Reset your password',
		greetingText = 'Hey there,',
		previewText = 'Reset your password',
		bodyText = 'We received a request to reset your password. Click the button below to set a new password:',
		buttonText = 'Reset Password',
		expiryText = 'This link will expire in 1 hour for security reasons.',
		disclaimerText = "If you didn't request this, you can safely ignore this email. Your password will remain unchanged."
	}: {
		resetUrl?: string;
		badgeText?: string;
		titleText?: string;
		greetingText?: string;
		previewText?: string;
		bodyText?: string;
		buttonText?: string;
		expiryText?: string;
		disclaimerText?: string;
	} = $props();
</script>

<Html>
	<Head />
	<Body class="mx-auto my-auto bg-white px-2 font-sans">
		<Preview preview={previewText} />
		<Container class="mx-auto my-10 max-w-md p-5">
			<Card.Root>
				<EmailHeader />
				<Card.Header>
					<Badge variant="secondary" class="mb-2">{badgeText}</Badge>
					<Card.Title>{titleText}</Card.Title>
					<Card.Description>{greetingText}</Card.Description>
				</Card.Header>

				<Card.Content>
					<p class="mb-4 text-sm text-foreground">
						{bodyText}
					</p>

					<Button class="mb-4" href={resetUrl}>{buttonText}</Button>

					<Alert.Root class="mb-4">
						<Alert.Description>
							{expiryText}
						</Alert.Description>
					</Alert.Root>

					<p class="text-sm text-muted-foreground">
						{disclaimerText}
					</p>
				</Card.Content>

				<Card.Footer>
					<EmailFooter />
				</Card.Footer>
			</Card.Root>
		</Container>
	</Body>
</Html>
