<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { getTranslate } from '@tolgee/svelte';
	// Regular UI components (what email SHOULD look like)
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import * as Alert from '$lib/components/ui/alert';
	import * as Item from '$lib/components/ui/item';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import * as Avatar from '$lib/components/ui/avatar';
	import { Progress } from '$lib/components/ui/progress';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';

	// Demo data
	const completionPercentage = 75;
	const buttonUrl = '#button-url';
	const userName = 'User';
	const userAvatar = 'https://github.com/shadcn.png';
	const { t } = getTranslate();
</script>

<SEOHead title={$t('meta.shadcn_demo.title')} description={$t('meta.shadcn_demo.description')} />

<div class="mx-auto max-w-[600px] py-10">
	<Card.Root>
		<Card.Header>
			<Card.Title>CardTitle</Card.Title>
			<Card.Description>CardDescription</Card.Description>
			<Badge>Badge</Badge>
		</Card.Header>

		<Card.Content class="flex flex-col gap-4">
			<Avatar.Root>
				<Avatar.Image src={userAvatar} alt={userName} />
				<Avatar.Fallback>{userName.substring(0, 2).toUpperCase()}</Avatar.Fallback>
			</Avatar.Root>
			<Alert.Alert>
				<Alert.AlertTitle>AlertTitle</Alert.AlertTitle>
				<Alert.AlertDescription>This is an alert description.</Alert.AlertDescription>
			</Alert.Alert>

			<Progress value={completionPercentage} />

			<Item.Root>
				<Item.Header>
					<Item.Media variant="icon">
						<CircleCheckIcon />
					</Item.Media>
					<Item.Content>
						<Item.Title>ItemTitle</Item.Title>
						<Item.Description>ItemDescription</Item.Description>
					</Item.Content>
				</Item.Header>
			</Item.Root>

			<Button href={buttonUrl}>Button</Button>
			<Button href={buttonUrl} variant="outline">Outline Variant Button</Button>
			<Button href={buttonUrl} variant="secondary">Secondary Variant Button</Button>
			<Button href={buttonUrl} variant="ghost">Ghost Variant Button</Button>
			<Button href={buttonUrl} variant="link">Link Variant Button</Button>

			<Separator />
		</Card.Content>

		<Card.Footer>
			<p class="text-xs text-muted-foreground">CardFooter in text-xs text-muted-foreground</p>
		</Card.Footer>
	</Card.Root>
</div>
