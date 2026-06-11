<script lang="ts">
	import { Html, Head, Body, Preview, Container } from '@better-svelte-email/components';
	import { Alert, Badge, Button, Card } from '$lib/emails/components/ui/index.js';
	import { EmailHeader, EmailFooter } from '$lib/emails/components/layout/index.js';

	// All user-facing copy is passed in as props so the caller can resolve
	// translated strings (see src/lib/convex/emails/templates.ts). English
	// defaults keep the build-time preview rendering.
	let {
		lang = 'en',
		verificationUrl = 'https://example.com/verify?token=xxx',
		badgeText = 'Auth',
		titleText = 'Verify your email',
		descriptionText = 'Click the button below to verify your email address',
		previewText = 'Verify your email address',
		introText = 'Thanks for signing up! Please verify your email address to complete your registration.',
		buttonText = 'Verify Email',
		expiryText = 'This link will expire in 20 minutes.',
		disclaimerText = "If you didn't create an account, please ignore this email."
	}: {
		lang?: string;
		verificationUrl?: string;
		badgeText?: string;
		titleText?: string;
		descriptionText?: string;
		previewText?: string;
		introText?: string;
		buttonText?: string;
		expiryText?: string;
		disclaimerText?: string;
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
					<p class="mb-4 text-sm text-foreground">
						{introText}
					</p>

					<Button class="mb-4" href={verificationUrl}>{buttonText}</Button>

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
