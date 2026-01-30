<script lang="ts">
	import { authClient } from '$lib/auth-client.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as Item from '$lib/components/ui/item/index.js';
	import { toast } from 'svelte-sonner';
	import { T, getTranslate } from '@tolgee/svelte';
	import KeyIcon from '@lucide/svelte/icons/key-round';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import type { Passkey } from '@better-auth/passkey';
	import { getAuthErrorKey } from '$lib/utils/auth-messages';

	const { t } = getTranslate();

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
				error = getAuthErrorKey(err, 'auth.messages.passkey_load_failed');
			} else {
				passkeys = data ?? [];
			}
		} catch {
			error = 'auth.messages.passkey_load_failed';
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
				error = getAuthErrorKey(result.error, 'auth.messages.passkey_add_failed');
				toast.error($t(error));
			} else {
				toast.success($t('auth.messages.passkey_added'));
				newPasskeyName = '';
				await loadPasskeys();
			}
		} catch {
			error = 'auth.messages.passkey_add_failed';
			toast.error($t(error));
		} finally {
			isAdding = false;
		}
	}

	async function handleDeletePasskey(id: string) {
		try {
			const { error: err } = await authClient.passkey.deletePasskey({ id });

			if (err) {
				toast.error($t(getAuthErrorKey(err, 'auth.messages.passkey_delete_failed')));
			} else {
				toast.success($t('auth.messages.passkey_deleted'));
				await loadPasskeys();
			}
		} catch {
			toast.error($t('auth.messages.passkey_delete_failed'));
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
		<Item.Root variant="muted">
			<Item.Media variant="icon">
				<ShieldCheckIcon />
			</Item.Media>
			<Item.Content>
				<Item.Title><T keyName="settings.security.passkey_info_title" /></Item.Title>
				<Item.Description>
					<T keyName="settings.security.passkey_info_description" />
				</Item.Description>
			</Item.Content>
		</Item.Root>

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
						placeholder={$t('settings.security.passkey.placeholder')}
					/>
				</div>
				<Button onclick={handleAddPasskey} disabled={isAdding}>
					{#if isAdding}
						<T keyName="settings.security.adding" />
					{:else}
						<PlusIcon />
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
				<Item.Group>
					{#each passkeys as passkey, index (passkey.id)}
						<Item.Root variant="outline">
							<Item.Media variant="icon">
								<KeyIcon />
							</Item.Media>
							<Item.Content>
								<Item.Title>{passkey.name || $t('settings.security.passkey.unnamed')}</Item.Title>
								<Item.Description>
									<T keyName="settings.security.created_at" />
									{formatDate(passkey.createdAt)}
								</Item.Description>
							</Item.Content>
							<Item.Actions>
								<Button
									variant="ghost"
									size="icon"
									onclick={() => handleDeletePasskey(passkey.id)}
									class="text-destructive hover:text-destructive"
								>
									<Trash2Icon class="h-4 w-4" />
								</Button>
							</Item.Actions>
						</Item.Root>
						{#if index !== passkeys.length - 1}
							<Item.Separator />
						{/if}
					{/each}
				</Item.Group>
			{/if}
		</div>

		{#if error}
			<Alert.Root variant="destructive">
				<Alert.Title><T keyName="settings.security.error_title" /></Alert.Title>
				<Alert.Description>
					<T keyName={error} />
				</Alert.Description>
			</Alert.Root>
		{/if}
	</Card.Content>
</Card.Root>
