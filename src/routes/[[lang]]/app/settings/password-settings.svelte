<script lang="ts">
	import { authClient } from '$lib/auth-client.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { toast } from 'svelte-sonner';
	import { T } from '@tolgee/svelte';
	import InfoIcon from '@lucide/svelte/icons/info';

	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let revokeOtherSessions = $state(true);
	let isLoading = $state(false);
	let error = $state('');

	async function handleChangePassword(e: Event) {
		e.preventDefault();
		error = '';

		// Validation
		if (newPassword !== confirmPassword) {
			error = 'New passwords do not match';
			return;
		}

		if (newPassword.length < 8) {
			error = 'Password must be at least 8 characters long';
			return;
		}

		isLoading = true;

		try {
			const { error: authError } = await authClient.changePassword({
				currentPassword,
				newPassword,
				revokeOtherSessions
			});

			if (authError) {
				error = authError.message || 'Failed to change password';
				toast.error(error);
			} else {
				toast.success('Password changed successfully');
				// Clear form
				currentPassword = '';
				newPassword = '';
				confirmPassword = '';
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'An unexpected error occurred';
			toast.error(error);
		} finally {
			isLoading = false;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title><T keyName="settings.password.title" /></Card.Title>
		<Card.Description><T keyName="settings.password.description" /></Card.Description>
	</Card.Header>
	<Card.Content>
		<form onsubmit={handleChangePassword} class="space-y-4">
			{#if error}
				<Alert.Root variant="destructive">
					<InfoIcon class="h-4 w-4" />
					<Alert.Title><T keyName="settings.password.error_title" /></Alert.Title>
					<Alert.Description>{error}</Alert.Description>
				</Alert.Root>
			{/if}

			<div class="space-y-2">
				<Label for="current-password">
					<T keyName="settings.password.current_password_label" />
				</Label>
				<Input
					id="current-password"
					type="password"
					bind:value={currentPassword}
					placeholder="Enter current password"
					required
					autocomplete="current-password"
				/>
			</div>

			<div class="space-y-2">
				<Label for="new-password">
					<T keyName="settings.password.new_password_label" />
				</Label>
				<Input
					id="new-password"
					type="password"
					bind:value={newPassword}
					placeholder="Enter new password"
					required
					autocomplete="new-password"
				/>
				<p class="text-sm text-muted-foreground">
					<T keyName="settings.password.password_helper" />
				</p>
			</div>

			<div class="space-y-2">
				<Label for="confirm-password">
					<T keyName="settings.password.confirm_password_label" />
				</Label>
				<Input
					id="confirm-password"
					type="password"
					bind:value={confirmPassword}
					placeholder="Confirm new password"
					required
					autocomplete="new-password"
				/>
			</div>

			<div class="flex items-center space-x-2">
				<Checkbox id="revoke-sessions" bind:checked={revokeOtherSessions} />
				<Label
					for="revoke-sessions"
					class="text-sm leading-none font-normal peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
				>
					<T keyName="settings.password.revoke_sessions_label" />
				</Label>
			</div>

			<Alert.Root>
				<InfoIcon class="h-4 w-4" />
				<Alert.Title><T keyName="settings.password.security_notice_title" /></Alert.Title>
				<Alert.Description>
					<T keyName="settings.password.security_notice_description" />
				</Alert.Description>
			</Alert.Root>

			<Button type="submit" disabled={isLoading}>
				{#if isLoading}
					<T keyName="settings.password.updating" />
				{:else}
					<T keyName="settings.password.update_button" />
				{/if}
			</Button>
		</form>
	</Card.Content>
</Card.Root>
