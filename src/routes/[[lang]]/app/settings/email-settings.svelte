<script lang="ts">
	import { authClient } from '$lib/auth-client.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { toast } from 'svelte-sonner';
	import { T } from '@tolgee/svelte';
	import InfoIcon from '@lucide/svelte/icons/info';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import { localizedHref } from '$lib/utils/i18n';

	interface Props {
		user: {
			email?: string;
			emailVerified?: boolean;
		} | null;
	}

	let { user }: Props = $props();

	let newEmail = $state('');
	let isLoading = $state(false);
	let error = $state('');

	let currentEmail = $derived(user?.email || '');
	let isEmailVerified = $derived(user?.emailVerified || false);

	async function handleChangeEmail(e: Event) {
		e.preventDefault();
		error = '';

		// Validation
		if (!newEmail || !newEmail.includes('@')) {
			error = 'Please enter a valid email address';
			return;
		}

		if (newEmail === currentEmail) {
			error = 'New email must be different from current email';
			return;
		}

		isLoading = true;

		try {
			await authClient.changeEmail({
				newEmail,
				callbackURL: localizedHref('/app/settings?email-changed=true')
			});

			toast.success(
				isEmailVerified
					? 'Verification email sent to your current address. Please check your inbox to approve the change.'
					: 'Email updated successfully'
			);

			// Clear form
			newEmail = '';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to change email';
			toast.error(error);
		} finally {
			isLoading = false;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title><T keyName="settings.email.title" /></Card.Title>
		<Card.Description><T keyName="settings.email.description" /></Card.Description>
	</Card.Header>
	<Card.Content>
		<div class="space-y-4">
			<!-- Current Email Display -->
			<div class="space-y-2">
				<Label><T keyName="settings.email.current_email_label" /></Label>
				<div class="flex items-center gap-2">
					<Input value={currentEmail} disabled class="bg-muted" />
					{#if isEmailVerified}
						<Badge variant="secondary" class="flex items-center gap-1">
							<CircleCheckIcon class="h-3 w-3" />
							<T keyName="settings.email.verified_badge" />
						</Badge>
					{:else}
						<Badge variant="outline">
							<T keyName="settings.email.unverified_badge" />
						</Badge>
					{/if}
				</div>
			</div>

			<form onsubmit={handleChangeEmail} class="space-y-4">
				{#if error}
					<Alert.Root variant="destructive">
						<InfoIcon class="h-4 w-4" />
						<Alert.Title><T keyName="settings.email.error_title" /></Alert.Title>
						<Alert.Description>{error}</Alert.Description>
					</Alert.Root>
				{/if}

				<div class="space-y-2">
					<Label for="new-email">
						<T keyName="settings.email.new_email_label" />
					</Label>
					<Input
						id="new-email"
						type="email"
						bind:value={newEmail}
						placeholder="Enter new email address"
						required
						autocomplete="email"
					/>
				</div>

				{#if isEmailVerified}
					<Alert.Root>
						<InfoIcon class="h-4 w-4" />
						<Alert.Title><T keyName="settings.email.verification_required_title" /></Alert.Title>
						<Alert.Description>
							<T keyName="settings.email.verification_required_description" />
						</Alert.Description>
					</Alert.Root>
				{:else}
					<Alert.Root>
						<InfoIcon class="h-4 w-4" />
						<Alert.Title><T keyName="settings.email.not_verified_title" /></Alert.Title>
						<Alert.Description>
							<T keyName="settings.email.not_verified_description" />
						</Alert.Description>
					</Alert.Root>
				{/if}

				<Button type="submit" disabled={isLoading}>
					{#if isLoading}
						<T keyName="settings.email.updating" />
					{:else}
						<T keyName="settings.email.update_button" />
					{/if}
				</Button>
			</form>
		</div>
	</Card.Content>
</Card.Root>
