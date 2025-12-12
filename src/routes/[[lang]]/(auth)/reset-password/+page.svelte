<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import { authClient } from '$lib/auth-client.js';
	import { localizedHref } from '$lib/utils/i18n';
	import { T } from '@tolgee/svelte';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		resetPasswordSchema,
		validatePasswordMatch,
		PASSWORD_MIN_LENGTH
	} from '$lib/schemas/auth.js';
	import { page } from '$app/state';

	let isLoading = $state(false);
	let message = $state<string | null>(null);
	let formError = $state<string | null>(null);

	// Get token directly from SvelteKit's page state
	const token = $derived(page.url.searchParams.get('token'));

	const form = superForm(
		defaults({ password: '', confirmPassword: '' }, zod4(resetPasswordSchema)),
		{
			validators: zod4(resetPasswordSchema),
			SPA: true,
			onUpdate: async ({ form: f }) => {
				if (!f.valid) return;

				// Check password confirmation
				const matchError = validatePasswordMatch(f.data.password, f.data.confirmPassword);
				if (matchError) {
					formError = matchError;
					return;
				}

				if (!token) {
					formError = 'Missing or invalid reset token';
					return;
				}

				isLoading = true;
				formError = null;
				message = null;

				try {
					const { error: err } = await authClient.resetPassword({
						newPassword: f.data.password,
						token
					});

					if (err) {
						formError = err.message ?? 'Failed to reset password';
					} else {
						message = 'Your password has been reset successfully.';
					}
				} catch {
					formError = 'Failed to reset password';
				} finally {
					isLoading = false;
				}
			}
		}
	);

	const { form: formData, enhance } = form;
</script>

<div class="flex min-h-screen w-full items-center justify-center px-4">
	<Card.Root class="mx-auto w-full max-w-sm">
		<Card.Header>
			<Card.Title class="text-2xl">
				<T keyName="auth.reset_password.title" defaultValue="Reset password" />
			</Card.Title>
			<Card.Description>
				<T keyName="auth.reset_password.description" defaultValue="Enter your new password" />
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<form method="POST" use:enhance class="grid gap-4">
				{#if formError}
					<div class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{formError}</div>
				{/if}
				{#if message}
					<div class="rounded-md bg-green-500/10 p-3 text-sm text-green-600 dark:text-green-400">
						<T keyName="auth.reset_password.success" defaultValue="Your password has been reset." />
						<a href={localizedHref('/signin')} class="underline">
							<T keyName="auth.reset_password.sign_in_link" defaultValue="Sign in" />
						</a>
					</div>
				{/if}

				<Form.Field {form} name="password">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>
								<T keyName="auth.reset_password.new_password_label" defaultValue="New password" />
							</Form.Label>
							<Input
								{...props}
								type="password"
								placeholder="••••••••"
								disabled={isLoading || !!message}
								bind:value={$formData.password}
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
								<T
									keyName="auth.reset_password.confirm_password_label"
									defaultValue="Confirm new password"
								/>
							</Form.Label>
							<Input
								{...props}
								type="password"
								placeholder="••••••••"
								disabled={isLoading || !!message}
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

				<Form.Button class="w-full" disabled={isLoading || !!message}>
					{#if isLoading}
						<T keyName="auth.reset_password.button_loading" defaultValue="Resetting..." />
					{:else}
						<T keyName="auth.reset_password.button_submit" defaultValue="Reset password" />
					{/if}
				</Form.Button>
			</form>
			<div class="mt-4 text-center">
				<a class="text-sm text-muted-foreground hover:underline" href={localizedHref('/signin')}>
					<T keyName="auth.reset_password.back_to_signin" defaultValue="Back to sign in" />
				</a>
			</div>
		</Card.Content>
	</Card.Root>
</div>
