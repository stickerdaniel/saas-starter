<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { authClient } from '$lib/auth-client.js';
	import { getContext } from 'svelte';
	import { localizedHref } from '$lib/utils/i18n';
	import { T } from '@tolgee/svelte';

	// Get email from auth layout context (persisted from signin page)
	const authEmailCtx = getContext<{ get: () => string; set: (v: string) => void }>('auth:email');
	let email = $state(authEmailCtx?.get() ?? '');
	let isLoading = $state(false);
	let message = $state<string | null>(null);
	let error = $state<string | null>(null);

	// Sync email changes back to context
	$effect(() => {
		if (authEmailCtx && email) {
			authEmailCtx.set(email);
		}
	});

	async function handleSubmit(e: Event) {
		e.preventDefault();
		isLoading = true;
		message = null;
		error = null;

		try {
			const { error: err } = await authClient.forgetPassword({
				email,
				redirectTo: localizedHref('/reset-password')
			});

			if (err) {
				error = err.message ?? 'Failed to send reset link';
			} else {
				message = 'Check your email for a reset link.';
			}
		} catch {
			error = 'Failed to request password reset';
		} finally {
			isLoading = false;
		}
	}
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
			<form onsubmit={handleSubmit} class="grid gap-4">
				{#if error}
					<div class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
				{/if}
				{#if message}
					<div class="rounded-md bg-green-500/10 p-3 text-sm text-green-600 dark:text-green-400">
						{message}
					</div>
				{/if}
				<div class="grid gap-2">
					<Label for="email">
						<T keyName="auth.signin.email_label" defaultValue="Email" />
					</Label>
					<Input
						id="email"
						type="email"
						bind:value={email}
						required
						placeholder="you@example.com"
						disabled={isLoading}
					/>
				</div>
				<Button type="submit" class="w-full" disabled={isLoading}>
					{#if isLoading}
						<T keyName="auth.forgot_password.button_loading" defaultValue="Sending..." />
					{:else}
						<T keyName="auth.forgot_password.button_submit" defaultValue="Send reset link" />
					{/if}
				</Button>
			</form>
			<div class="mt-4 text-center">
				<a class="text-sm text-muted-foreground hover:underline" href={localizedHref('/signin')}>
					<T keyName="auth.forgot_password.back_to_signin" defaultValue="Back to sign in" />
				</a>
			</div>
		</Card.Content>
	</Card.Root>
</div>
