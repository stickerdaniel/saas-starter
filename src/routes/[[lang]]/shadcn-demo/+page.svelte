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
	import { LoadingBar } from '$lib/components/ui/loading-bar';
	import { Switch } from '$lib/components/ui/switch';
	import { Toggle } from '$lib/components/ui/toggle';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import BoldIcon from '@lucide/svelte/icons/bold';

	// Demo data
	const completionPercentage = 75;
	const buttonUrl = '#button-url';
	const userName = 'User';
	const userAvatar = 'https://github.com/shadcn.png';
	const { t } = getTranslate();

	type LoadingBarDebugState =
		{ mode: 'progress'; value: number; label: string } | { mode: 'loading'; label: string };

	let loadingBarDebugState = $state<LoadingBarDebugState>({
		mode: 'progress',
		value: 0,
		label: 'Progress 0%'
	});

	function showEmptyProgress() {
		loadingBarDebugState = { mode: 'progress', value: 0, label: 'Progress 0%' };
	}

	function showMidProgress() {
		loadingBarDebugState = { mode: 'progress', value: 66, label: 'Progress 66%' };
	}

	function showLoading() {
		loadingBarDebugState = { mode: 'loading', label: 'Loading sweep' };
	}

	let switchOn = $state(false);
	let switchSmallOn = $state(true);
	let bold = $state(false);
	let checkedBox = $state(false);
	let mixedBox = $state(false);
</script>

<SEOHead title={$t('meta.shadcn_demo.title')} description={$t('meta.shadcn_demo.description')} />

<div class="mx-auto max-w-[600px] py-10">
	<Card.Root class="mb-8" lang="en">
		<Card.Header>
			<Card.Title>Loading Bar Debug</Card.Title>
			<Card.Description>
				Temporary harness for switching between determinate progress and loading mode.
			</Card.Description>
		</Card.Header>

		<Card.Content class="flex flex-col gap-4">
			<LoadingBar
				mode={loadingBarDebugState.mode}
				value={loadingBarDebugState.mode === 'progress' ? loadingBarDebugState.value : undefined}
				class="h-1 rounded-none"
			/>

			<div class="flex flex-wrap gap-2">
				<Button onclick={showEmptyProgress} variant="outline">Progress 0%</Button>
				<Button onclick={showMidProgress} variant="outline">Progress 66%</Button>
				<Button onclick={showLoading}>Loading</Button>
			</div>

			<p class="text-sm text-muted-foreground">Current state: {loadingBarDebugState.label}</p>
		</Card.Content>
	</Card.Root>

	<!-- lang="en" like the harness card above it: the labels here are the
	     component names, there are no translation keys behind them, and the
	     route inherits the requested locale. -->
	<Card.Root class="mb-8" lang="en">
		<Card.Header>
			<Card.Title>Controls</Card.Title>
			<Card.Description>
				Switch, Toggle and Checkbox, so their motion can be exercised by hand.
			</Card.Description>
		</Card.Header>

		<Card.Content class="flex flex-col gap-4">
			<div class="flex items-center gap-3">
				<Switch id="demo-switch" bind:checked={switchOn} />
				<Label for="demo-switch">Switch ({switchOn ? 'on' : 'off'})</Label>
			</div>

			<div class="flex items-center gap-3">
				<Switch id="demo-switch-sm" size="sm" bind:checked={switchSmallOn} />
				<Label for="demo-switch-sm">Switch, small ({switchSmallOn ? 'on' : 'off'})</Label>
			</div>

			<div class="flex items-center gap-3">
				<!-- Visible labels rather than aria-label: this harness has no i18n keys
				     and the lint rule rightly refuses hardcoded accessible names. -->
				<Toggle bind:pressed={bold}><BoldIcon />Bold</Toggle>
				<Toggle variant="outline" bind:pressed={bold}>Bold, outline</Toggle>
			</div>

			<div class="flex items-center gap-3">
				<Checkbox id="demo-checkbox" bind:checked={checkedBox} />
				<Label for="demo-checkbox">Checkbox</Label>
			</div>

			<div class="flex items-center gap-3">
				<Checkbox id="demo-checkbox-mixed" indeterminate bind:checked={mixedBox} />
				<Label for="demo-checkbox-mixed">Checkbox, starting indeterminate</Label>
			</div>

			<div class="flex items-center gap-3">
				<!-- bits-ui accepts both flags and reports the box as mixed, so the
				     mark has to be visible in that state too. It was not. -->
				<Checkbox id="demo-checkbox-both" indeterminate checked />
				<Label for="demo-checkbox-both">Checkbox, checked and indeterminate</Label>
			</div>
		</Card.Content>
	</Card.Root>

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
