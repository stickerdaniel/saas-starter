<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { authClient } from '$lib/auth-client.js';
	import { localizedHref } from '$lib/utils/i18n';
	import { T } from '@tolgee/svelte';

	let password = $state('');
	let confirmPassword = $state('');
	let isLoading = $state(false);
	let message = $state<string | null>(null);
	let error = $state<string | null>(null);

	function getTokenFromUrl() {
		try {
			const url = new URL(window.location.href);
			return url.searchParams.get('token');
		} catch {
			return null;
		}
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		error = null;
		message = null;

		if (password.length < 8) {
			error = 'Password must be at least 8 characters';
			return;
		}
		if (password !== confirmPassword) {
			error = 'Passwords do not match';
			return;
		}

		const token = getTokenFromUrl();
		if (!token) {
			error = 'Missing or invalid reset token';
			return;
		}

		isLoading = true;
		try {
			const { error: err } = await authClient.resetPassword({
				newPassword: password,
				token
			});

			if (err) {
				error = err.message ?? 'Failed to reset password';
			} else {
				message = 'Your password has been reset successfully.';
			}
		} catch {
			error = 'Failed to reset password';
		} finally {
			isLoading = false;
		}
	}
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
			<form onsubmit={handleSubmit} class="grid gap-4">
				{#if error}
					<div class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
				{/if}
				{#if message}
					<div class="rounded-md bg-green-500/10 p-3 text-sm text-green-600 dark:text-green-400">
						<T keyName="auth.reset_password.success" defaultValue="Your password has been reset." />
						<a href={localizedHref('/signin')} class="underline">
							<T keyName="auth.reset_password.sign_in_link" defaultValue="Sign in" />
						</a>
					</div>
				{/if}
				<div class="grid gap-2">
					<Label for="password">
						<T keyName="auth.reset_password.new_password_label" defaultValue="New password" />
					</Label>
					<Input
						id="password"
						type="password"
						bind:value={password}
						required
						minlength={8}
						placeholder="••••••••"
						disabled={isLoading || !!message}
					/>
				</div>
				<div class="grid gap-2">
					<Label for="confirm">
						<T
							keyName="auth.reset_password.confirm_password_label"
							defaultValue="Confirm new password"
						/>
					</Label>
					<Input
						id="confirm"
						type="password"
						bind:value={confirmPassword}
						required
						minlength={8}
						placeholder="••••••••"
						disabled={isLoading || !!message}
					/>
				</div>
				<Button type="submit" class="w-full" disabled={isLoading || !!message}>
					{#if isLoading}
						<T keyName="auth.reset_password.button_loading" defaultValue="Resetting..." />
					{:else}
						<T keyName="auth.reset_password.button_submit" defaultValue="Reset password" />
					{/if}
				</Button>
			</form>
			<div class="mt-4 text-center">
				<a class="text-sm text-muted-foreground hover:underline" href={localizedHref('/signin')}>
					<T keyName="auth.reset_password.back_to_signin" defaultValue="Back to sign in" />
				</a>
			</div>
		</Card.Content>
	</Card.Root>
</div>
