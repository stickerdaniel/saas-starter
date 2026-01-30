<script lang="ts">
	import * as v from 'valibot';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		FieldGroup,
		Field,
		FieldLabel,
		FieldDescription,
		FieldError
	} from '$lib/components/ui/field/index.js';
	import { authClient } from '$lib/auth-client.js';
	import { localizedHref } from '$lib/utils/i18n';
	import { resolve } from '$app/paths';
	import { T, getTranslate } from '@tolgee/svelte';
	import { PASSWORD_MIN_LENGTH, resetPasswordSchema } from './schema.js';
	import { page } from '$app/state';
	import { getAuthErrorKey } from '$lib/utils/auth-messages';
	import { translateValidationErrors } from '$lib/utils/validation-i18n.js';

	const { t } = getTranslate();

	let isLoading = $state(false);
	let message = $state<string | null>(null);
	let formError = $state<string | null>(null);

	const id = $props.id();

	// Get token directly from SvelteKit's page state
	const token = $derived(page.url.searchParams.get('token'));

	// Form data
	let formData = $state({ password: '', confirmPassword: '' });

	// Field errors
	let errors = $state<Record<string, string[]>>({});

	// Translation params for password min_length validation
	const passwordParams = {
		'validation.password.min_length': { count: PASSWORD_MIN_LENGTH }
	};

	function validate(): boolean {
		// Map form data to schema field names (_password, _confirmPassword)
		const dataForValidation = {
			_password: formData.password,
			_confirmPassword: formData.confirmPassword
		};
		const result = v.safeParse(resetPasswordSchema, dataForValidation);
		if (!result.success) {
			const fieldErrors: Record<string, string[]> = {};
			for (const issue of result.issues) {
				const path = issue.path?.[0]?.key as string;
				// Map _password/_confirmPassword back to password/confirmPassword for display
				const fieldName =
					path === '_password'
						? 'password'
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

		if (!token) {
			formError = 'auth.messages.missing_reset_token';
			return;
		}

		isLoading = true;
		formError = null;
		message = null;

		try {
			const { error: err } = await authClient.resetPassword({
				newPassword: formData.password,
				token
			});

			if (err) {
				formError = getAuthErrorKey(err, 'auth.messages.reset_failed');
			} else {
				message = 'auth.messages.password_reset_success';
			}
		} catch (error) {
			console.error('[ResetPassword] Reset error:', error);
			formError = 'auth.messages.reset_failed';
		} finally {
			isLoading = false;
		}
	}
</script>

<noscript>
	<div class="fixed inset-x-0 top-0 z-50 bg-yellow-100 p-4 text-center text-yellow-800">
		JavaScript is required for authentication. Please enable JavaScript to continue.
	</div>
</noscript>

<div class="flex min-h-svh flex-col items-center justify-center p-6 md:p-10">
	<div class="flex w-full max-w-sm flex-col gap-6 md:max-w-3xl">
		<Card.Root class="overflow-hidden p-0">
			<Card.Content class="grid p-0 md:grid-cols-2">
				<form onsubmit={handleSubmit} novalidate class="p-6 md:p-8">
					<FieldGroup>
						<div class="flex flex-col items-center gap-2 text-center">
							<h1 class="text-2xl font-bold">
								<T keyName="auth.reset_password.title" defaultValue="Reset password" />
							</h1>
							<p class="text-balance text-muted-foreground">
								<T
									keyName="auth.reset_password.description"
									defaultValue="Enter your new password"
								/>
							</p>
						</div>
						{#if formError}
							<Field>
								<div class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
									<T keyName={formError} />
								</div>
							</Field>
						{/if}
						{#if message}
							<Field>
								<div
									class="rounded-md bg-green-500/10 p-3 text-sm text-green-600 dark:text-green-400"
								>
									<T keyName={message} />
									<a href={resolve(localizedHref('/signin'))} class="underline">
										<T keyName="auth.reset_password.sign_in_link" defaultValue="Sign in" />
									</a>
								</div>
							</Field>
						{/if}
						<Field>
							<FieldLabel for="password-{id}">
								<T keyName="auth.reset_password.new_password_label" defaultValue="New password" />
							</FieldLabel>
							<Input
								id="password-{id}"
								type="password"
								placeholder="••••••••"
								disabled={isLoading || !!message}
								bind:value={formData.password}
							/>
							<FieldDescription>
								<T
									keyName="auth.signup.password_hint"
									defaultValue="Minimum 10 characters with uppercase, lowercase, and number"
								/>
							</FieldDescription>
							<FieldError errors={translateValidationErrors(errors.password, $t, passwordParams)} />
						</Field>
						<Field>
							<FieldLabel for="confirm-password-{id}">
								<T
									keyName="auth.reset_password.confirm_password_label"
									defaultValue="Confirm new password"
								/>
							</FieldLabel>
							<Input
								id="confirm-password-{id}"
								type="password"
								placeholder="••••••••"
								disabled={isLoading || !!message}
								bind:value={formData.confirmPassword}
							/>
							<FieldError errors={translateValidationErrors(errors.confirmPassword, $t)} />
						</Field>
						<Field>
							<Button type="submit" class="w-full" disabled={isLoading || !!message}>
								{#if isLoading}
									<T keyName="auth.reset_password.button_loading" defaultValue="Resetting..." />
								{:else}
									<T keyName="auth.reset_password.button_submit" defaultValue="Reset password" />
								{/if}
							</Button>
						</Field>
						<FieldDescription class="text-center">
							<a href={resolve(localizedHref('/signin'))} class="underline underline-offset-4">
								<T keyName="auth.reset_password.back_to_signin" defaultValue="Back to sign in" />
							</a>
						</FieldDescription>
					</FieldGroup>
				</form>
				<div class="relative hidden bg-muted md:block">
					<img
						src="/placeholder.svg"
						alt=""
						class="absolute inset-0 h-full w-full object-cover dark:brightness-[0.2] dark:grayscale"
					/>
				</div>
			</Card.Content>
		</Card.Root>
		<FieldDescription class="px-6 text-center">
			<T keyName="auth.terms.agreement" defaultValue="By clicking continue, you agree to our" />
			<a href={resolve(localizedHref('/terms'))} class="underline underline-offset-4"
				><T keyName="auth.terms.terms_of_service" defaultValue="Terms of Service" /></a
			>
			<T keyName="auth.terms.and" defaultValue="and" />
			<a href={resolve(localizedHref('/privacy'))} class="underline underline-offset-4"
				><T keyName="auth.terms.privacy_policy" defaultValue="Privacy Policy" /></a
			>.
			<a href={resolve(localizedHref('/'))} class="underline underline-offset-4"
				><T keyName="auth.back_to_home" defaultValue="Back to home" /></a
			>
		</FieldDescription>
	</div>
</div>
