<script lang="ts">
	import { authClient } from '$lib/auth-client.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { toast } from 'svelte-sonner';
	import { T } from '@tolgee/svelte';
	import KeyIcon from '@lucide/svelte/icons/key-round';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';

	interface Passkey {
		id: string;
		name?: string | null;
		createdAt: Date;
	}

	let passkeys = $state<Passkey[]>([]);
	let isLoading = $state(false);
	let isAdding = $state(false);
	let newPasskeyName = $state('');
	let error = $state('');

	// Load passkeys on mount
	$effect(() => {
		loadPasskeys();
	});

	async function loadPasskeys() {
		isLoading = true;
		try {
			const { data, error: err } = await authClient.passkey.listUserPasskeys();
			if (err) {
				error = err.message || 'Failed to load passkeys';
			} else {
				passkeys = (data || []) as Passkey[];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load passkeys';
		} finally {
			isLoading = false;
		}
	}

	async function handleAddPasskey() {
		isAdding = true;
		error = '';

		try {
			const result = await authClient.passkey.addPasskey({
				name: newPasskeyName || undefined
			});

			if (result?.error) {
				error = result.error.message || 'Failed to add passkey';
				toast.error(error);
			} else {
				toast.success('Passkey added successfully');
				newPasskeyName = '';
				await loadPasskeys();
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to add passkey';
			toast.error(error);
		} finally {
			isAdding = false;
		}
	}

	async function handleDeletePasskey(id: string) {
		try {
			const { error: err } = await authClient.passkey.deletePasskey({ id });

			if (err) {
				toast.error(err.message || 'Failed to delete passkey');
			} else {
				toast.success('Passkey deleted');
				await loadPasskeys();
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to delete passkey';
			toast.error(message);
		}
	}

	function formatDate(date: Date): string {
		return new Date(date).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title><T keyName="settings.security.title" /></Card.Title>
		<Card.Description><T keyName="settings.security.description" /></Card.Description>
	</Card.Header>
	<Card.Content class="space-y-6">
		<!-- Passkey Info -->
		<Alert.Root>
			<ShieldCheckIcon class="h-4 w-4" />
			<Alert.Title><T keyName="settings.security.passkey_info_title" /></Alert.Title>
			<Alert.Description>
				<T keyName="settings.security.passkey_info_description" />
			</Alert.Description>
		</Alert.Root>

		<!-- Add New Passkey -->
		<div class="space-y-4">
			<h3 class="text-sm font-semibold">
				<T keyName="settings.security.add_passkey_title" />
			</h3>
			<div class="flex gap-2">
				<div class="flex-1">
					<Label class="sr-only" for="passkey-name">
						<T keyName="settings.security.passkey_name_label" />
					</Label>
					<Input
						id="passkey-name"
						type="text"
						bind:value={newPasskeyName}
						placeholder="Passkey name (optional)"
					/>
				</div>
				<Button onclick={handleAddPasskey} disabled={isAdding}>
					{#if isAdding}
						<T keyName="settings.security.adding" />
					{:else}
						<PlusIcon class="mr-2 h-4 w-4" />
						<T keyName="settings.security.add_button" />
					{/if}
				</Button>
			</div>
			<p class="text-sm text-muted-foreground">
				<T keyName="settings.security.add_passkey_helper" />
			</p>
		</div>

		<!-- Existing Passkeys -->
		<div class="space-y-4">
			<h3 class="text-sm font-semibold">
				<T keyName="settings.security.your_passkeys_title" />
			</h3>

			{#if isLoading}
				<p class="text-sm text-muted-foreground">
					<T keyName="settings.security.loading" />
				</p>
			{:else if passkeys.length === 0}
				<p class="text-sm text-muted-foreground">
					<T keyName="settings.security.no_passkeys" />
				</p>
			{:else}
				<div class="space-y-2">
					{#each passkeys as passkey (passkey.id)}
						<div
							class="flex items-center justify-between rounded-lg border bg-card p-3 text-card-foreground"
						>
							<div class="flex items-center gap-3">
								<KeyIcon class="h-5 w-5 text-muted-foreground" />
								<div>
									<p class="text-sm font-medium">
										{passkey.name || 'Unnamed Passkey'}
									</p>
									<p class="text-xs text-muted-foreground">
										<T keyName="settings.security.created_at" />
										{formatDate(passkey.createdAt)}
									</p>
								</div>
							</div>
							<Button
								variant="ghost"
								size="sm"
								onclick={() => handleDeletePasskey(passkey.id)}
								class="text-destructive hover:text-destructive"
							>
								<Trash2Icon class="h-4 w-4" />
							</Button>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		{#if error}
			<Alert.Root variant="destructive">
				<Alert.Title><T keyName="settings.security.error_title" /></Alert.Title>
				<Alert.Description>{error}</Alert.Description>
			</Alert.Root>
		{/if}
	</Card.Content>
</Card.Root>
