<script lang="ts">
	import { Html, Head, Body, Preview, Container } from 'better-svelte-email/components';
	import { Badge, Button, Card } from '$lib/emails/components/ui/index.js';
	import { EmailHeader, EmailFooter } from '$lib/emails/components/layout/index.js';

	let {
		titleText = 'New support ticket',
		descriptionText = 'A user has started a new support conversation',
		previewText = 'New support ticket',
		messagesHtml = '<p>No messages</p>',
		adminDashboardLink = 'https://example.com/admin/support'
	}: {
		titleText?: string;
		descriptionText?: string;
		previewText?: string;
		messagesHtml?: string;
		adminDashboardLink?: string;
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
					<Badge variant="destructive" class="mb-2">Support</Badge>
					<Card.Title>{titleText}</Card.Title>
					<Card.Description>{descriptionText}</Card.Description>
				</Card.Header>

				<Card.Content>
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					{@html messagesHtml}

					<Button class="mt-4 mb-4" href={adminDashboardLink}>View in Admin Dashboard</Button>

					<p class="text-xs text-muted-foreground">
						You're receiving this email because you are assigned to this ticket or are configured to
						receive support notifications.
					</p>
				</Card.Content>

				<Card.Footer>
					<EmailFooter />
				</Card.Footer>
			</Card.Root>
		</Container>
	</Body>
</Html>
