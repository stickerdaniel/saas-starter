<script lang="ts">
	import * as v from 'valibot';
	import { authClient } from '$lib/auth-client.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as InputGroup from '$lib/components/ui/input-group/index.js';
	import * as Item from '$lib/components/ui/item/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { toast } from 'svelte-sonner';
	import { T, getTranslate } from '@tolgee/svelte';
	import InfoIcon from '@lucide/svelte/icons/info';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import { localizedHref } from '$lib/utils/i18n';
	import { changeEmailSchema } from './email-schema.js';
	import { getAuthErrorKey } from '$lib/utils/auth-messages';
	import { translateValidationErrors } from '$lib/utils/validation-i18n.js';

	const { t } = getTranslate();

	interface Props {
		user: {
			email?: string;
			emailVerified?: boolean;
		} | null;
	}

	let { user }: Props = $props();

	let isLoading = $state(false);
	let formError = $state('');

	let currentEmail = $derived(user?.email || '');
	let isEmailVerified = $derived(user?.emailVerified || false);

	// Form data
	let formData = $state({ newEmail: '' });

	// Field errors
	let errors = $state<Record<string, string[]>>({});

	function validate(): boolean {
		const result = v.safeParse(changeEmailSchema, formData);
		if (!result.success) {
			const fieldErrors: Record<string, string[]> = {};
			for (const issue of result.issues) {
				const path = (issue.path?.[0]?.key as string) || 'newEmail';
				// Keep the first issue per field so inline errors stay focused and predictable.
				if (!fieldErrors[path]) fieldErrors[path] = [issue.message];
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

		if (formData.newEmail === currentEmail) {
			formError = 'auth.messages.email_same_as_current';
			toast.error($t(formError));
			return;
		}

		isLoading = true;
		formError = '';

		try {
			const { error: authError } = await authClient.changeEmail({
				newEmail: formData.newEmail,
				callbackURL: localizedHref('/app/settings?email-changed=true')
			});

			if (authError) {
				formError = getAuthErrorKey(authError, 'auth.messages.email_change_failed');
				toast.error($t(formError));
				return;
			}

			toast.success(
				isEmailVerified
					? $t('auth.messages.email_verification_sent')
					: $t('auth.messages.email_updated')
			);

			// Clear form
			formData.newEmail = '';
		} catch (err) {
			console.error('[EmailSettings] Change email error:', err);
			formError = 'auth.messages.email_change_failed';
			toast.error($t(formError));
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
		<form onsubmit={handleSubmit} class="space-y-4">
			{#if formError}
				<Alert.Root variant="destructive">
					<InfoIcon class="h-4 w-4" />
					<Alert.Title><T keyName="settings.email.error_title" /></Alert.Title>
					<Alert.Description>
						<T keyName={formError} />
					</Alert.Description>
				</Alert.Root>
			{/if}

			<Field.Group>
				<Field.Field>
					<Field.Label for="currentEmail">
						<T keyName="settings.email.current_email_label" />
					</Field.Label>
					<InputGroup.Root data-disabled>
						<InputGroup.Input id="currentEmail" value={currentEmail} disabled />
						<InputGroup.Addon align="inline-end">
							{#if isEmailVerified}
								<div class="flex items-center gap-1 text-green-600">
									<CircleCheckIcon class="h-3 w-3" />
									<InputGroup.Text>
										<T keyName="settings.email.verified_badge" />
									</InputGroup.Text>
								</div>
							{:else}
								<InputGroup.Text class="text-muted-foreground">
									<T keyName="settings.email.unverified_badge" />
								</InputGroup.Text>
							{/if}
						</InputGroup.Addon>
					</InputGroup.Root>
				</Field.Field>

				<Field.Field>
					<Field.Label for="newEmail">
						<T keyName="settings.email.new_email_label" />
					</Field.Label>
					<Input
						type="email"
						id="newEmail"
						name="newEmail"
						placeholder={$t('settings.email.placeholder')}
						autocomplete="email"
						bind:value={formData.newEmail}
					/>
					<Field.Error errors={translateValidationErrors(errors.newEmail, $t)} />
				</Field.Field>
			</Field.Group>

			{#if isEmailVerified}
				<Item.Root variant="muted">
					<Item.Media variant="icon">
						<InfoIcon />
					</Item.Media>
					<Item.Content>
						<Item.Title><T keyName="settings.email.verification_required_title" /></Item.Title>
						<Item.Description>
							<T keyName="settings.email.verification_required_description" />
						</Item.Description>
					</Item.Content>
				</Item.Root>
			{:else}
				<Item.Root variant="muted">
					<Item.Media variant="icon">
						<InfoIcon />
					</Item.Media>
					<Item.Content>
						<Item.Title><T keyName="settings.email.not_verified_title" /></Item.Title>
						<Item.Description>
							<T keyName="settings.email.not_verified_description" />
						</Item.Description>
					</Item.Content>
				</Item.Root>
			{/if}

			<div class="flex justify-end">
				<Button type="submit" disabled={isLoading}>
					{#if isLoading}
						<T keyName="settings.email.updating" />
					{:else}
						<T keyName="settings.email.update_button" />
					{/if}
				</Button>
			</div>
		</form>
	</Card.Content>
</Card.Root>
