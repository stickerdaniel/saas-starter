<script lang="ts">
	import * as v from 'valibot';
	import { authClient } from '$lib/auth-client.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as Item from '$lib/components/ui/item/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { toast } from 'svelte-sonner';
	import { T, getTranslate } from '@tolgee/svelte';
	import InfoIcon from '@lucide/svelte/icons/info';
	import { changePasswordSchema, PASSWORD_MIN_LENGTH } from './password-schema.js';
	import { getAuthErrorKey } from '$lib/utils/auth-messages';
	import { translateValidationErrors } from '$lib/utils/validation-i18n.js';

	const { t } = getTranslate();

	let isLoading = $state(false);
	let formError = $state('');

	// Form data
	let formData = $state({
		currentPassword: '',
		newPassword: '',
		confirmPassword: '',
		revokeOtherSessions: true
	});

	// Field errors
	let errors = $state<Record<string, string[]>>({});

	// Translation params for password min_length validation
	const passwordParams = {
		'validation.password.min_length': { count: PASSWORD_MIN_LENGTH }
	};

	function validate(): boolean {
		// Map form data to schema field names (with _ prefix for sensitive fields)
		const dataForValidation = {
			_currentPassword: formData.currentPassword,
			_newPassword: formData.newPassword,
			_confirmPassword: formData.confirmPassword,
			revokeOtherSessions: formData.revokeOtherSessions
		};
		const result = v.safeParse(changePasswordSchema, dataForValidation);
		if (!result.success) {
			const fieldErrors: Record<string, string[]> = {};
			for (const issue of result.issues) {
				const path = issue.path?.[0]?.key as string;
				// Map _prefixed field names back for display
				const fieldName =
					path === '_currentPassword'
						? 'currentPassword'
						: path === '_newPassword'
							? 'newPassword'
							: path === '_confirmPassword'
								? 'confirmPassword'
								: path;
				if (!fieldErrors[fieldName]) fieldErrors[fieldName] = [];
				fieldErrors[fieldName].push(issue.message);
			}
			errors = fieldErrors;
			return false;
		}
		errors = {};
		return true;
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!validate()) return;

		isLoading = true;
		formError = '';

		try {
			const { error: authError } = await authClient.changePassword({
				currentPassword: formData.currentPassword,
				newPassword: formData.newPassword,
				revokeOtherSessions: formData.revokeOtherSessions
			});

			if (authError) {
				formError = getAuthErrorKey(authError, 'auth.messages.password_change_failed');
				toast.error($t(formError));
			} else {
				toast.success($t('auth.messages.password_changed'));
				// Clear form
				formData.currentPassword = '';
				formData.newPassword = '';
				formData.confirmPassword = '';
			}
		} catch (err) {
			console.error('[PasswordSettings] Change password error:', err);
			formError = 'auth.messages.password_change_failed';
			toast.error($t(formError));
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
		<form onsubmit={handleSubmit} class="space-y-4">
			{#if formError}
				<Alert.Root variant="destructive">
					<InfoIcon class="h-4 w-4" />
					<Alert.Title><T keyName="settings.password.error_title" /></Alert.Title>
					<Alert.Description>
						<T keyName={formError} />
					</Alert.Description>
				</Alert.Root>
			{/if}

			<Field.Group>
				<Field.Field>
					<Field.Label for="currentPassword">
						<T keyName="settings.password.current_password_label" />
					</Field.Label>
					<Input
						type="password"
						id="currentPassword"
						name="currentPassword"
						placeholder="Enter current password"
						autocomplete="current-password"
						bind:value={formData.currentPassword}
					/>
					<Field.Error errors={translateValidationErrors(errors.currentPassword, $t)} />
				</Field.Field>

				<Field.Field>
					<Field.Label for="newPassword">
						<T keyName="settings.password.new_password_label" />
					</Field.Label>
					<Input
						type="password"
						id="newPassword"
						name="newPassword"
						placeholder="Enter new password"
						autocomplete="new-password"
						bind:value={formData.newPassword}
					/>
					<Field.Description>
						<T keyName="auth.signup.password_hint" />
					</Field.Description>
					<Field.Error errors={translateValidationErrors(errors.newPassword, $t, passwordParams)} />
				</Field.Field>

				<Field.Field>
					<Field.Label for="confirmPassword">
						<T keyName="settings.password.confirm_password_label" />
					</Field.Label>
					<Input
						type="password"
						id="confirmPassword"
						name="confirmPassword"
						placeholder="Confirm new password"
						autocomplete="new-password"
						bind:value={formData.confirmPassword}
					/>
					<Field.Error errors={translateValidationErrors(errors.confirmPassword, $t)} />
				</Field.Field>

				<Field.Field orientation="horizontal">
					<Checkbox
						id="revokeOtherSessions"
						name="revokeOtherSessions"
						bind:checked={formData.revokeOtherSessions}
					/>
					<Field.Content>
						<Field.Label for="revokeOtherSessions">
							<T keyName="settings.password.revoke_sessions_label" />
						</Field.Label>
						<Field.Description>
							<T keyName="settings.password.security_notice_description" />
						</Field.Description>
					</Field.Content>
				</Field.Field>
			</Field.Group>

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
