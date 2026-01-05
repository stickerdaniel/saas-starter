<script lang="ts">
	import { Html, Head, Body, Preview, Container } from 'better-svelte-email/components';
	// Real shadcn-svelte components (not email-safe)
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Item from '$lib/components/ui/item/index.js';
	import { Progress } from '$lib/components/ui/progress/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';

	// Demo data
	const completionPercentage = 75;
	const buttonUrl = '#button-url';
	const userName = 'User';
	const userAvatar = 'https://github.com/shadcn.png';
</script>

<Html>
	<Head />
	<Preview preview="Shadcn Reference Email (Real Components)" />
	<Body class="mx-auto my-auto bg-white px-2 font-sans">
		<Container class="mx-auto my-10 max-w-md p-5">
			<Card.Root>
				<Card.Header>
					<Card.Title>CardTitle</Card.Title>
					<Card.Description>CardDescription</Card.Description>
					<Badge>Badge</Badge>
				</Card.Header>

				<Card.Content class="flex flex-col gap-4">
					<Avatar.Root loadingStatus="loaded">
						<Avatar.Image src={userAvatar} alt={userName} />
					</Avatar.Root>

					<Alert.Root>
						<Alert.Title>AlertTitle</Alert.Title>
						<Alert.Description>This is an alert description.</Alert.Description>
					</Alert.Root>

					<Progress value={completionPercentage} />

					<Item.Root>
						<Item.Header>
							<Item.Media variant="icon">&#10003;</Item.Media>
							<Item.Content>
								<Item.Title>ItemTitle</Item.Title>
								<Item.Description>ItemDescription</Item.Description>
							</Item.Content>
						</Item.Header>
					</Item.Root>

					<div class="flex flex-col gap-4">
						<Button href={buttonUrl}>Button</Button>
						<Button href={buttonUrl} variant="outline">Outline Variant Button</Button>
						<Button href={buttonUrl} variant="secondary">Secondary Variant Button</Button>
						<Button href={buttonUrl} variant="ghost">Ghost Variant Button</Button>
						<Button href={buttonUrl} variant="link">Link Variant Button</Button>
					</div>

					<Separator />
				</Card.Content>

				<Card.Footer>
					<p class="text-xs text-muted-foreground">CardFooter in text-xs text-muted-foreground</p>
				</Card.Footer>
			</Card.Root>
		</Container>
	</Body>
</Html>
