<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import { authClient } from '$lib/auth-client.js';
	import { getContext } from 'svelte';
	import { localizedHref } from '$lib/utils/i18n';
	import { T } from '@tolgee/svelte';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { forgotPasswordSchema, PASSWORD_MIN_LENGTH } from '$lib/schemas/auth.js';

	// Get email from auth layout context (persisted from signin page)
	const authEmailCtx = getContext<{ get: () => string; set: (v: string) => void }>('auth:email');

	let isLoading = $state(false);
	let message = $state<string | null>(null);
	let formError = $state<string | null>(null);

	const form = superForm(defaults({ email: '' }, zod4(forgotPasswordSchema)), {
		validators: zod4(forgotPasswordSchema),
		SPA: true,
		onUpdate: async ({ form: f }) => {
			if (!f.valid) return;
			isLoading = true;
			message = null;
			formError = null;

			try {
				const { error: err } = await authClient.requestPasswordReset({
					email: f.data.email,
					redirectTo: localizedHref('/reset-password')
				});

				if (err) {
					formError = err.message ?? 'Failed to send reset link';
				} else {
					message = 'Check your email for a reset link.';
				}
			} catch {
				formError = 'Failed to request password reset';
			} finally {
				isLoading = false;
			}
		}
	});

	const { form: formData, enhance } = form;

	// Initialize email from context
	$effect(() => {
		const savedEmail = authEmailCtx?.get();
		if (savedEmail && !$formData.email) {
			$formData.email = savedEmail;
		}
	});

	// Sync email changes back to context
	$effect(() => {
		if (authEmailCtx && $formData.email) {
			authEmailCtx.set($formData.email);
		}
	});
</script>

<div class="flex min-h-screen w-full items-center justify-center px-4">
	<Card.Root class="mx-auto w-full max-w-sm">
		<Card.Header>
			<Card.Title class="text-2xl">
				<T keyName="auth.forgot_password.title" defaultValue="Forgot password" />
			</Card.Title>
			<Card.Description>
				<T
					keyName="auth.forgot_password.description"
					defaultValue="We will email you a reset link"
				/>
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<form method="POST" use:enhance class="grid gap-4">
				{#if formError}
					<div class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{formError}</div>
				{/if}
				{#if message}
					<div class="rounded-md bg-green-500/10 p-3 text-sm text-green-600 dark:text-green-400">
						{message}
					</div>
				{/if}

				<Form.Field {form} name="email">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>
								<T keyName="auth.signin.email_label" defaultValue="Email" />
							</Form.Label>
							<Input
								{...props}
								type="email"
								placeholder="you@example.com"
								disabled={isLoading}
								bind:value={$formData.email}
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

				<Form.Button class="w-full" disabled={isLoading}>
					{#if isLoading}
						<T keyName="auth.forgot_password.button_loading" defaultValue="Sending..." />
					{:else}
						<T keyName="auth.forgot_password.button_submit" defaultValue="Send reset link" />
					{/if}
				</Form.Button>
			</form>
			<div class="mt-4 text-center">
				<a class="text-sm text-muted-foreground hover:underline" href={localizedHref('/signin')}>
					<T keyName="auth.forgot_password.back_to_signin" defaultValue="Back to sign in" />
				</a>
			</div>
		</Card.Content>
	</Card.Root>
</div>
