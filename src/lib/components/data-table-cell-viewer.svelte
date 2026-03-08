<script lang="ts">
	import TrendingUpIcon from '@tabler/icons-svelte/icons/trending-up';

	import * as Drawer from '$lib/components/ui/drawer/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import type { Schema } from './schemas.js';

	const isMobile = new IsMobile();

	let { item }: { item: Schema } = $props();

	// Intentionally snapshot initial item values for editing.
	// svelte-ignore state_referenced_locally
	let type = $state(item.type);
	// Intentionally snapshot initial item values for editing.
	// svelte-ignore state_referenced_locally
	let status = $state(item.status);
	// Intentionally snapshot initial item values for editing.
	// svelte-ignore state_referenced_locally
	let reviewer = $state(item.reviewer);
</script>

<Drawer.Root direction={isMobile.current ? 'bottom' : 'right'}>
	<Drawer.Trigger>
		{#snippet child({ props })}
			<Button variant="link" class="w-fit px-0 text-left text-foreground" {...props}>
				{item.header}
			</Button>
		{/snippet}
	</Drawer.Trigger>
	<Drawer.Content>
		<Drawer.Header class="gap-1">
			<Drawer.Title>{item.header}</Drawer.Title>
			<Drawer.Description>Showing total visitors for the last 6 months</Drawer.Description>
		</Drawer.Header>
		<div class="flex flex-col gap-4 overflow-y-auto px-4 text-sm">
			{#if !isMobile.current}
				<div
					class="flex h-40 items-center justify-center rounded-xl border border-dashed bg-muted/40"
				>
					<span class="text-muted-foreground"
						>Chart temporarily disabled for server-rendered builds.</span
					>
				</div>
				<Separator />
				<div class="grid gap-2">
					<div class="flex gap-2 leading-none font-medium">
						Trending up by 5.2% this month
						<TrendingUpIcon class="size-4" />
					</div>
					<div class="text-muted-foreground">
						Showing total visitors for the last 6 months. This is just some random text to test the
						layout. It spans multiple lines and should wrap around.
					</div>
				</div>
				<Separator />
			{/if}
			<form class="flex flex-col gap-4">
				<Field.Group>
					<Field.Field>
						<Field.Label for="header">Header</Field.Label>
						<Input id="header" value={item.header} />
					</Field.Field>
					<div class="grid grid-cols-2 gap-4">
						<Field.Field>
							<Field.Label for="type">Type</Field.Label>
							<Select.Root type="single" bind:value={type}>
								<Select.Trigger id="type" class="w-full">
									{type ?? 'Select a type'}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="Table of Contents">Table of Contents</Select.Item>
									<Select.Item value="Executive Summary">Executive Summary</Select.Item>
									<Select.Item value="Technical Approach">Technical Approach</Select.Item>
									<Select.Item value="Design">Design</Select.Item>
									<Select.Item value="Capabilities">Capabilities</Select.Item>
									<Select.Item value="Focus Documents">Focus Documents</Select.Item>
									<Select.Item value="Narrative">Narrative</Select.Item>
									<Select.Item value="Cover Page">Cover Page</Select.Item>
								</Select.Content>
							</Select.Root>
						</Field.Field>
						<Field.Field>
							<Field.Label for="status">Status</Field.Label>
							<Select.Root type="single" bind:value={status}>
								<Select.Trigger id="status" class="w-full">
									{status ?? 'Select a status'}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="Done">Done</Select.Item>
									<Select.Item value="In Progress">In Progress</Select.Item>
									<Select.Item value="Not Started">Not Started</Select.Item>
								</Select.Content>
							</Select.Root>
						</Field.Field>
					</div>
					<div class="grid grid-cols-2 gap-4">
						<Field.Field>
							<Field.Label for="target">Target</Field.Label>
							<Input id="target" value={item.target} />
						</Field.Field>
						<Field.Field>
							<Field.Label for="limit">Limit</Field.Label>
							<Input id="limit" value={item.limit} />
						</Field.Field>
					</div>
					<Field.Field>
						<Field.Label for="reviewer">Reviewer</Field.Label>
						<Select.Root type="single" bind:value={reviewer}>
							<Select.Trigger id="reviewer" class="w-full">
								{reviewer ?? 'Select a reviewer'}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="Eddie Lake">Eddie Lake</Select.Item>
								<Select.Item value="Jamik Tashpulatov">Jamik Tashpulatov</Select.Item>
								<Select.Item value="Emily Whalen">Emily Whalen</Select.Item>
							</Select.Content>
						</Select.Root>
					</Field.Field>
				</Field.Group>
			</form>
		</div>
		<Drawer.Footer>
			<Button>Submit</Button>
			<Drawer.Close>
				{#snippet child({ props })}
					<Button variant="outline" {...props}>Done</Button>
				{/snippet}
			</Drawer.Close>
		</Drawer.Footer>
	</Drawer.Content>
</Drawer.Root>
