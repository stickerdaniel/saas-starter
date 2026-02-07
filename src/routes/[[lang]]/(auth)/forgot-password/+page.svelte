<script lang="ts">
	import * as v from 'valibot';
	import * as Card from '$lib/components/ui/card/index.js';
	import { LoadingBar } from '$lib/components/ui/loading-bar/index.js';
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
	import { forgotPasswordSchema } from './schema.js';
	import { authFlow } from '$lib/hooks/auth-flow.svelte';
	import { getAuthErrorKey } from '$lib/utils/auth-messages';
	import { translateValidationErrors } from '$lib/utils/validation-i18n.js';

	const { t } = getTranslate();

	let isLoading = $state(false);
	let message = $state<string | null>(null);
	let formError = $state<string | null>(null);
	let lastValidSubmission = $state<string | null>(null);

	const id = $props.id();

	// Form data
	let formData = $state({ email: '' });

	// Field errors
	let errors = $state<Record<string, string[]>>({});
	const totalSteps = 2;
	const validation = $derived.by(() => {
		const result = v.safeParse(forgotPasswordSchema, formData);
		const invalidFields = new Set<string>(
			result.success
				? []
				: result.issues
						.map((issue) => issue.path?.[0]?.key)
						.filter((key): key is string => typeof key === 'string')
		);
		return {
			isEmailValid: !invalidFields.has('email')
		};
	});
	const submissionToken = $derived(formData.email);
	const completedSteps = $derived(
		(validation.isEmailValid ? 1 : 0) + (lastValidSubmission === submissionToken ? 1 : 0)
	);
	const progress = $derived((completedSteps / totalSteps) * 100);

	// Initialize email from global state
	$effect(() => {
		if (authFlow.email && !formData.email) {
			formData.email = authFlow.email;
		}
	});

	// Sync email changes back to global state
	$effect(() => {
		if (formData.email) {
			authFlow.email = formData.email;
		}
	});

	function validate(): boolean {
		const result = v.safeParse(forgotPasswordSchema, formData);
		if (!result.success) {
			const fieldErrors: Record<string, string[]> = {};
			for (const issue of result.issues) {
				const path = issue.path?.[0]?.key as string;
				if (!fieldErrors[path]) fieldErrors[path] = [];
				fieldErrors[path].push(issue.message);
			}
			errors = fieldErrors;
			return false;
		}
		errors = {};
		return true;
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!validate()) {
			lastValidSubmission = null;
			return;
		}
		lastValidSubmission = submissionToken;

		isLoading = true;
		message = null;
		formError = null;

		try {
			const { error: err } = await authClient.requestPasswordReset({
				email: formData.email,
				redirectTo: localizedHref('/reset-password')
			});

			if (err) {
				formError = getAuthErrorKey(err, 'auth.messages.request_reset_failed');
			} else {
				message = 'auth.messages.reset_link_sent';
			}
		} catch (error) {
			console.error('[ForgotPassword] Request error:', error);
			formError = 'auth.messages.request_reset_failed';
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
				<form onsubmit={handleSubmit} novalidate class="min-h-96">
					<LoadingBar value={progress} class="h-1 rounded-none" />
					<div class="p-6 md:p-8">
						<FieldGroup>
							<div class="flex flex-col items-center gap-2 text-center">
								<h1 class="text-2xl font-bold">
									<T keyName="auth.forgot_password.title" defaultValue="Forgot password" />
								</h1>
								<p class="text-balance text-muted-foreground">
									<T
										keyName="auth.forgot_password.description"
										defaultValue="We will email you a reset link"
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
									</div>
								</Field>
							{/if}
							<Field>
								<FieldLabel for="email-{id}">
									<T keyName="auth.signin.email_label" defaultValue="Email" />
								</FieldLabel>
								<Input
									id="email-{id}"
									type="email"
									placeholder="m@example.com"
									disabled={isLoading}
									bind:value={formData.email}
								/>
								<FieldError errors={translateValidationErrors(errors.email, $t)} />
							</Field>
							<Field>
								<Button type="submit" class="w-full" disabled={isLoading}>
									{#if isLoading}
										<T keyName="auth.forgot_password.button_loading" defaultValue="Sending..." />
									{:else}
										<T
											keyName="auth.forgot_password.button_submit"
											defaultValue="Send reset link"
										/>
									{/if}
								</Button>
							</Field>
							<FieldDescription class="text-center">
								<a href={resolve(localizedHref('/signin'))} class="underline underline-offset-4">
									<T keyName="auth.forgot_password.back_to_signin" defaultValue="Back to sign in" />
								</a>
							</FieldDescription>
						</FieldGroup>
					</div>
				</form>
				<div class="relative hidden bg-muted md:block">
					<img
						src="/placeholder.svg"
						alt=""
						draggable="false"
						class="absolute inset-0 h-full w-full object-cover select-none dark:brightness-[0.2] dark:grayscale"
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
