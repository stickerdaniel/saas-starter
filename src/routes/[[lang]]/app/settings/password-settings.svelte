<script lang="ts">
	import { authClient } from '$lib/auth-client.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as Item from '$lib/components/ui/item/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { toast } from 'svelte-sonner';
	import { T } from '@tolgee/svelte';
	import InfoIcon from '@lucide/svelte/icons/info';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		changePasswordSchema,
		validatePasswordMatch,
		PASSWORD_MIN_LENGTH
	} from '$lib/schemas/auth.js';

	let isLoading = $state(false);
	let formError = $state('');

	const form = superForm(
		defaults(
			{ currentPassword: '', newPassword: '', confirmPassword: '', revokeOtherSessions: true },
			zod4(changePasswordSchema)
		),
		{
			validators: zod4(changePasswordSchema),
			SPA: true,
			onUpdate: async ({ form: f }) => {
				if (!f.valid) return;

				// Check password confirmation
				const matchError = validatePasswordMatch(f.data.newPassword, f.data.confirmPassword);
				if (matchError) {
					formError = matchError;
					toast.error(matchError);
					return;
				}

				isLoading = true;
				formError = '';

				try {
					const { error: authError } = await authClient.changePassword({
						currentPassword: f.data.currentPassword,
						newPassword: f.data.newPassword,
						revokeOtherSessions: f.data.revokeOtherSessions
					});

					if (authError) {
						formError = authError.message || 'Failed to change password';
						toast.error(formError);
					} else {
						toast.success('Password changed successfully');
						// Clear form
						$formData.currentPassword = '';
						$formData.newPassword = '';
						$formData.confirmPassword = '';
					}
				} catch (err) {
					formError = err instanceof Error ? err.message : 'An unexpected error occurred';
					toast.error(formError);
				} finally {
					isLoading = false;
				}
			}
		}
	);

	const { form: formData, enhance } = form;
</script>

<Card.Root>
	<Card.Header>
		<Card.Title><T keyName="settings.password.title" /></Card.Title>
		<Card.Description><T keyName="settings.password.description" /></Card.Description>
	</Card.Header>
	<Card.Content>
		<form method="POST" use:enhance class="space-y-4">
			{#if formError}
				<Alert.Root variant="destructive">
					<InfoIcon class="h-4 w-4" />
					<Alert.Title><T keyName="settings.password.error_title" /></Alert.Title>
					<Alert.Description>{formError}</Alert.Description>
				</Alert.Root>
			{/if}

			<Form.Field {form} name="currentPassword">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>
							<T keyName="settings.password.current_password_label" />
						</Form.Label>
						<Input
							{...props}
							type="password"
							placeholder="Enter current password"
							autocomplete="current-password"
							bind:value={$formData.currentPassword}
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors>
					{#snippet children({ errors })}
						{#each errors as error}
							<span class="block text-sm text-destructive">
								<T keyName={error} params={{ minLength: PASSWORD_MIN_LENGTH }} />
							</span>
						{/each}
					{/snippet}
				</Form.FieldErrors>
			</Form.Field>

			<Form.Field {form} name="newPassword">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>
							<T keyName="settings.password.new_password_label" />
						</Form.Label>
						<Input
							{...props}
							type="password"
							placeholder="Enter new password"
							autocomplete="new-password"
							bind:value={$formData.newPassword}
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors>
					{#snippet children({ errors })}
						{#each errors as error}
							<span class="block text-sm text-destructive">
								<T keyName={error} params={{ minLength: PASSWORD_MIN_LENGTH }} />
							</span>
						{/each}
					{/snippet}
				</Form.FieldErrors>
			</Form.Field>

			<Form.Field {form} name="confirmPassword">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>
							<T keyName="settings.password.confirm_password_label" />
						</Form.Label>
						<Input
							{...props}
							type="password"
							placeholder="Confirm new password"
							autocomplete="new-password"
							bind:value={$formData.confirmPassword}
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors>
					{#snippet children({ errors })}
						{#each errors as error}
							<span class="block text-sm text-destructive">
								<T keyName={error} params={{ minLength: PASSWORD_MIN_LENGTH }} />
							</span>
						{/each}
					{/snippet}
				</Form.FieldErrors>
			</Form.Field>

			<Form.Field {form} name="revokeOtherSessions">
				<Form.Control>
					{#snippet children({ props })}
						<div class="flex items-center space-x-2">
							<Checkbox {...props} bind:checked={$formData.revokeOtherSessions} />
							<Form.Label class="text-sm font-normal leading-none">
								<T keyName="settings.password.revoke_sessions_label" />
							</Form.Label>
						</div>
					{/snippet}
				</Form.Control>
			</Form.Field>

			<Item.Root variant="muted">
				<Item.Media variant="icon">
					<InfoIcon />
				</Item.Media>
				<Item.Content>
					<Item.Title><T keyName="settings.password.security_notice_title" /></Item.Title>
					<Item.Description>
						<T keyName="settings.password.security_notice_description" />
					</Item.Description>
				</Item.Content>
			</Item.Root>

			<Form.Button disabled={isLoading}>
				{#if isLoading}
					<T keyName="settings.password.updating" />
				{:else}
					<T keyName="settings.password.update_button" />
				{/if}
			</Form.Button>
		</form>
	</Card.Content>
</Card.Root>
