<script lang="ts">
	import { Html, Head, Body, Preview, Container } from 'better-svelte-email/components';
	import { Badge, Button, Card } from '$lib/emails/components/ui/index.js';
	import { EmailHeader, EmailFooter } from '$lib/emails/components/layout/index.js';

	let {
		userName = 'New User',
		userEmail = 'user@example.com',
		signupMethod = 'Email',
		signupTime = 'Jan 15, 2026 at 3:45 PM',
		adminDashboardLink = 'https://example.com/admin/users'
	}: {
		userName?: string;
		userEmail?: string;
		signupMethod?: string;
		signupTime?: string;
		adminDashboardLink?: string;
	} = $props();
</script>

<Html>
	<Head />
	<Body class="mx-auto my-auto bg-white px-2 font-sans">
		<Preview preview="New user: {userEmail}" />
		<Container class="mx-auto my-10 max-w-md p-5">
			<Card.Root>
				<EmailHeader />
				<Card.Header>
					<Badge class="mb-2 border-transparent bg-blue-600 text-white">Stats</Badge>
					<Card.Title>New user signed up</Card.Title>
					<Card.Description>A new user has registered on your platform</Card.Description>
				</Card.Header>

				<Card.Content>
					<div
						style="background-color: #f4f4f5; border-radius: 6px; padding: 16px; margin-bottom: 16px;"
					>
						<p style="margin: 0 0 8px 0; font-size: 14px;">
							<strong>Name:</strong>
							{userName}
						</p>
						<p style="margin: 0 0 8px 0; font-size: 14px;">
							<strong>Email:</strong>
							{userEmail}
						</p>
						<p style="margin: 0 0 8px 0; font-size: 14px;">
							<strong>Method:</strong>
							{signupMethod}
						</p>
						<p style="margin: 0; font-size: 14px;">
							<strong>Time:</strong>
							{signupTime}
						</p>
					</div>

					<Button class="mb-4" href={adminDashboardLink}>View in Admin Dashboard</Button>

					<p class="text-xs text-muted-foreground">
						You're receiving this email because you have new signup notifications enabled.
					</p>
				</Card.Content>

				<Card.Footer>
					<EmailFooter />
				</Card.Footer>
			</Card.Root>
		</Container>
	</Body>
</Html>
