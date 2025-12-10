<script lang="ts">
	import { authClient } from '$lib/auth-client.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as InputGroup from '$lib/components/ui/input-group/index.js';
	import * as Item from '$lib/components/ui/item/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { toast } from 'svelte-sonner';
	import { T } from '@tolgee/svelte';
	import InfoIcon from '@lucide/svelte/icons/info';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import { localizedHref } from '$lib/utils/i18n';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { changeEmailSchema } from '$lib/schemas/auth.js';

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

	const form = superForm(defaults({ newEmail: '' }, zod4(changeEmailSchema)), {
		validators: zod4(changeEmailSchema),
		SPA: true,
		onUpdate: async ({ form: f }) => {
			if (!f.valid) return;

			if (f.data.newEmail === currentEmail) {
				formError = 'settings.email.errors.same_email';
				toast.error('New email must be different from current email');
				return;
			}

			isLoading = true;
			formError = '';

			try {
				await authClient.changeEmail({
					newEmail: f.data.newEmail,
					callbackURL: localizedHref('/app/settings?email-changed=true')
				});

				toast.success(
					isEmailVerified
						? 'Verification email sent to your current address. Please check your inbox to approve the change.'
						: 'Email updated successfully'
				);

				// Clear form
				$formData.newEmail = '';
			} catch (err) {
				formError = err instanceof Error ? err.message : 'Failed to change email';
				toast.error(formError);
			} finally {
				isLoading = false;
			}
		}
	});

	const { form: formData, enhance } = form;
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
				<InputGroup.Root data-disabled>
					<InputGroup.Input value={currentEmail} disabled />
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
			</div>

			<form method="POST" use:enhance class="space-y-4">
				{#if formError}
					<Alert.Root variant="destructive">
						<InfoIcon class="h-4 w-4" />
						<Alert.Title><T keyName="settings.email.error_title" /></Alert.Title>
						<Alert.Description>
							{#if formError.startsWith('settings.')}
								<T keyName={formError} />
							{:else}
								{formError}
							{/if}
						</Alert.Description>
					</Alert.Root>
				{/if}

				<Form.Field {form} name="newEmail">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>
								<T keyName="settings.email.new_email_label" />
							</Form.Label>
							<Input
								{...props}
								type="email"
								placeholder="Enter new email address"
								autocomplete="email"
								bind:value={$formData.newEmail}
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors>
						{#snippet children({ errors })}
							{#each errors as error}
								<span class="block text-sm text-destructive">
									<T keyName={error} />
								</span>
							{/each}
						{/snippet}
					</Form.FieldErrors>
				</Form.Field>

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

				<Form.Button disabled={isLoading}>
					{#if isLoading}
						<T keyName="settings.email.updating" />
					{:else}
						<T keyName="settings.email.update_button" />
					{/if}
				</Form.Button>
			</form>
		</div>
	</Card.Content>
</Card.Root>
