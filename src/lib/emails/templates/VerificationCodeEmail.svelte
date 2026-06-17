<script lang="ts">
	import { Html, Body, Preview, Container } from '@better-svelte-email/components';
	import { Alert, Badge, Card } from '$lib/emails/components/ui/index.js';
	import { EmailHead, EmailHeader, EmailFooter } from '$lib/emails/components/layout/index.js';

	// All user-facing copy is passed in as props so the caller can resolve
	// translated strings (see src/lib/convex/emails/templates.ts). English
	// defaults keep the build-time preview rendering.
	let {
		lang = 'en',
		code = '12345678',
		badgeText = 'Auth',
		titleText = 'Verify your email',
		descriptionText = 'Enter this code to complete your verification',
		previewText = 'Your verification code is 12345678',
		expiryText = 'This code will expire in 20 minutes.',
		disclaimerText = "If you didn't request this code, please ignore this email."
	}: {
		lang?: string;
		code?: string;
		badgeText?: string;
		titleText?: string;
		descriptionText?: string;
		previewText?: string;
		expiryText?: string;
		disclaimerText?: string;
	} = $props();
</script>

<Html {lang}>
	<EmailHead />
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
					<div class="mb-7 py-6 text-center">
						<p class="font-mono text-3xl font-bold tracking-widest text-foreground">{code}</p>
					</div>

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
