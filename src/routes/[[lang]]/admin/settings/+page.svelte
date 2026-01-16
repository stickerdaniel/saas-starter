<script lang="ts">
	import type { PageData } from './$types';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { T, getTranslate } from '@tolgee/svelte';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api.js';
	import { toast } from 'svelte-sonner';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	const { t } = getTranslate();

	// Get Convex client for mutations
	const client = useConvexClient();

	// Form state - track both input and last saved value
	let savedEmail = $state(data.defaultSupportEmail ?? '');
	let emailInput = $state(data.defaultSupportEmail ?? '');
	let isSaving = $state(false);
	let saveError = $state<string | null>(null);

	// Check if value has changed from last saved value
	let hasChanges = $derived(emailInput !== savedEmail);

	async function handleSave() {
		isSaving = true;
		saveError = null;

		try {
			await client.mutation(api.admin.settings.mutations.updateDefaultSupportEmail, {
				email: emailInput
			});
			savedEmail = emailInput; // Update saved value to match current input
			toast.success($t('admin.settings.saved'));
		} catch (error) {
			saveError = error instanceof Error ? error.message : 'Failed to save settings';
		} finally {
			isSaving = false;
		}
	}
</script>

<div class="flex flex-1 flex-col px-4 lg:px-6">
	<div class="flex-1 space-y-6">
		<div>
			<h2 class="text-2xl font-bold tracking-tight">
				<T keyName="admin.settings.title" />
			</h2>
			<p class="text-muted-foreground">
				<T keyName="admin.settings.description" />
			</p>
		</div>

		<Separator />

		<Tabs.Root value="notifications" class="space-y-6">
			<Tabs.List>
				<Tabs.Trigger value="notifications">
					<T keyName="admin.settings.tabs.notifications" />
				</Tabs.Trigger>
			</Tabs.List>

			<Tabs.Content value="notifications" class="space-y-6">
				<Card.Root>
					<Card.Header>
						<Card.Title>
							<T keyName="admin.settings.support_notifications" />
						</Card.Title>
						<Card.Description>
							<T keyName="admin.settings.support_notifications_desc" />
						</Card.Description>
					</Card.Header>

					<Card.Content>
						<div class="flex flex-col gap-4">
							<div class="flex flex-col gap-2">
								<Label for="default-email">
									<T keyName="admin.settings.default_support_email" />
								</Label>
								<Input
									id="default-email"
									type="email"
									placeholder={$t('admin.settings.default_support_email_placeholder')}
									bind:value={emailInput}
									disabled={isSaving}
								/>
								<p class="text-sm text-muted-foreground">
									<T keyName="admin.settings.default_support_email_help" />
								</p>
							</div>

							{#if saveError}
								<p class="text-sm text-destructive">{saveError}</p>
							{/if}
						</div>
					</Card.Content>

					<Card.Footer>
						<Button onclick={handleSave} disabled={isSaving || !hasChanges}>
							{#if isSaving}
								<T keyName="admin.settings.saving" />
							{:else}
								<T keyName="admin.settings.save" />
							{/if}
						</Button>
					</Card.Footer>
				</Card.Root>
			</Tabs.Content>
		</Tabs.Root>
	</div>
</div>
