<script lang="ts">
	import { Html, Head, Body, Preview, Container } from 'better-svelte-email/components';
	import {
		Alert,
		Avatar,
		Badge,
		Button,
		Card,
		Item,
		Progress,
		Separator
	} from '$lib/emails/components/ui/index.js';

	// Demo data
	const completionPercentage = 75;
	const buttonUrl = '#button-url';
	const userName = 'User';
	const userAvatar = 'https://github.com/shadcn.png';
</script>

<Html>
	<Head />
	<Preview preview="Shadcn Demo Email" />
	<Body class="mx-auto my-auto bg-white px-2 font-sans">
		<Container class="mx-auto my-10 max-w-md p-5">
			<Card.Root>
				<Card.Header>
					<Card.Title>CardTitle</Card.Title>
					<Card.Description>CardDescription</Card.Description>
					<Badge>Badge</Badge>
				</Card.Header>

				<Card.Content>
					<Avatar.Root class="mb-4">
						<Avatar.Image src={userAvatar} alt={userName} />
					</Avatar.Root>

					<Alert.Root class="mb-4">
						<Alert.Title>AlertTitle</Alert.Title>
						<Alert.Description>This is an alert description.</Alert.Description>
					</Alert.Root>

					<Progress class="mb-4" value={completionPercentage} />

					<Item.Root class="mb-4">
						<Item.Header>
							<Item.Media variant="icon" align="top">✓</Item.Media>
							<Item.Content>
								<Item.Title>ItemTitle</Item.Title>
								<Item.Description>ItemDescription</Item.Description>
							</Item.Content>
						</Item.Header>
					</Item.Root>

					<Button class="mb-4" href={buttonUrl}>Button</Button>
					<Button class="mb-4" href={buttonUrl} variant="outline">Outline Variant Button</Button>
					<Button class="mb-4" href={buttonUrl} variant="secondary">Secondary Variant Button</Button
					>
					<Button class="mb-4" href={buttonUrl} variant="ghost">Ghost Variant Button</Button>
					<Button class="mb-4" href={buttonUrl} variant="link">Link Variant Button</Button>

					<Separator />
				</Card.Content>

				<Card.Footer>
					<p class="text-xs text-muted-foreground">CardFooter in text-xs text-muted-foreground</p>
				</Card.Footer>
			</Card.Root>
		</Container>
	</Body>
</Html>
