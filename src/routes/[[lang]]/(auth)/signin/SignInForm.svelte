<script lang="ts">
	import { onMount } from 'svelte';
	import { T, getTranslate } from '@tolgee/svelte';
	import { resolve } from '$app/paths';
	import { localizedHref } from '$lib/utils/i18n';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { LoadingBar } from '$lib/components/ui/loading-bar/index.js';
	import * as Password from '$lib/components/ui/password';
	import { translateFormError, translateValidationErrors } from '$lib/utils/validation-i18n.js';
	import OAuthButtons from './OAuthButtons.svelte';
	import type { LastAuthMethod, PendingOAuthProvider } from '$lib/hooks/last-auth-method.svelte';

	type Props = {
		id: string;
		signInData: {
			email: string;
			password: string;
		};
		signInErrors: Record<string, string[]>;
		formError: string;
		isLoading: boolean;
		signInProgress: number;
		hasAlternativeAuth: boolean;
		enabledProviderCount: number;
		oauthProviders:
			| {
					google?: boolean;
					github?: boolean;
			  }
			| undefined;
		redirectTo: string | undefined;
		termsLink: HTMLAnchorElement | null;
		isLastUsedAuthMethod: (method: LastAuthMethod) => boolean;
		onSubmit: (event: SubmitEvent) => void | Promise<void>;
		onOAuth: (provider: PendingOAuthProvider) => void | Promise<void>;
		onPasskey: () => void | Promise<void>;
	};

	let {
		id,
		signInData,
		signInErrors,
		formError,
		isLoading,
		signInProgress,
		hasAlternativeAuth,
		enabledProviderCount,
		oauthProviders,
		redirectTo,
		termsLink,
		isLastUsedAuthMethod,
		onSubmit,
		onOAuth,
		onPasskey
	}: Props = $props();

	const { t } = getTranslate();

	let hydrated = $state(false);
	let forgotPasswordLink = $state<HTMLAnchorElement | null>(null);
	let signUpLink = $state<HTMLAnchorElement | null>(null);
	const isFormDisabled = $derived(isLoading || !hydrated);

	onMount(() => {
		hydrated = true;
	});

	function handleSignUpLinkKeydown(event: KeyboardEvent) {
		if (event.key !== 'Tab' || event.shiftKey || !forgotPasswordLink) return;
		event.preventDefault();
		forgotPasswordLink.focus();
	}

	function handleForgotPasswordKeydown(event: KeyboardEvent) {
		if (event.key !== 'Tab') return;
		if (event.shiftKey && signUpLink) {
			event.preventDefault();
			signUpLink.focus();
			return;
		}
		if (!event.shiftKey && termsLink) {
			event.preventDefault();
			termsLink.focus();
		}
	}

	function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		void onSubmit(event);
	}

	// Debug: override loading bar state for testing the state machine
	let debugActive = $state(false);
	let debugValue = $state(0);
	let debugIndeterminate = $state(false);
	const barMode = $derived(
		debugActive ? (debugIndeterminate ? 'loading' : 'progress') : isLoading ? 'loading' : 'progress'
	);
	const barValue = $derived(debugActive ? debugValue : signInProgress);
</script>

<form
	onsubmit={handleSubmit}
	action="/api/auth/sign-in/email"
	method="POST"
	novalidate
	class="min-h-96"
>
	<LoadingBar value={barValue} mode={barMode} class="h-1 rounded-none" />
	<div class="p-6 md:p-8">
		<Field.Group>
			<div class="flex flex-col items-center gap-2 text-center">
				<h1 class="text-2xl font-bold">
					<T keyName="auth.signin.title" />
				</h1>
				<p class="text-balance text-muted-foreground">
					<T keyName="auth.signin.description" />
				</p>
			</div>
			<Field.Field>
				<Field.Label for="email-{id}"><T keyName="auth.signin.email_label" /></Field.Label>
				<Input
					id="email-{id}"
					name="username"
					data-testid="email-input"
					type="email"
					autocomplete="username"
					placeholder="m@example.com"
					disabled={isFormDisabled}
					bind:value={signInData.email}
				/>
				<Field.Error errors={translateValidationErrors(signInErrors.email, $t)} />
			</Field.Field>
			<Field.Field>
				<div class="flex items-center">
					<Field.Label for="password-{id}">
						<T keyName="auth.signin.password_label" />
					</Field.Label>
					<a
						bind:this={forgotPasswordLink}
						href={resolve(localizedHref('/forgot-password'))}
						tabindex="-1"
						onkeydown={handleForgotPasswordKeydown}
						class="ms-auto text-sm text-muted-foreground underline-offset-2 hover:underline active:translate-y-px"
					>
						<T keyName="auth.signin.forgot_password" />
					</a>
				</div>
				<Password.Root>
					<Password.Input
						id="password-{id}"
						name="password"
						data-testid="password-input"
						autocomplete="current-password"
						disabled={isFormDisabled}
						bind:value={signInData.password}
					>
						<Password.ToggleVisibility />
					</Password.Input>
				</Password.Root>
				<Field.Error errors={translateValidationErrors(signInErrors.password, $t)} />
			</Field.Field>
			<Field.Error errors={translateFormError(formError, $t)} data-testid="auth-error" />
			<Field.Field>
				<Button type="submit" class="w-full" disabled={isFormDisabled} data-testid="signin-button">
					{#if isLoading}
						<T keyName="auth.signin.button_signin_loading" />
					{:else}
						<T keyName="auth.signin.button_signin" />
					{/if}
				</Button>
			</Field.Field>
			{#if hasAlternativeAuth}
				<Field.Separator class="*:data-[slot=field-separator-content]:bg-card">
					<T keyName="auth.signin.or_continue_with" />
				</Field.Separator>
				<Field.Field>
					<OAuthButtons
						mode="signin"
						providers={oauthProviders}
						isLoading={isFormDisabled}
						showPasskey={true}
						{enabledProviderCount}
						{isLastUsedAuthMethod}
						{onOAuth}
						{onPasskey}
					/>
				</Field.Field>
			{/if}
			<Field.Description class="text-center">
				<T keyName="auth.signin.no_account" defaultValue="Don't have an account?" />
				<a
					bind:this={signUpLink}
					href={resolve(
						localizedHref('/signup') +
							(redirectTo ? `?redirectTo=${encodeURIComponent(redirectTo)}` : '')
					)}
					onkeydown={handleSignUpLinkKeydown}
					class="underline underline-offset-4 active:translate-y-px"
				>
					<T keyName="auth.signin.link_signup" defaultValue="Sign up" />
				</a>
			</Field.Description>
		</Field.Group>
	</div>
</form>

{#if import.meta.env.DEV}
	<!-- Debug: LoadingBar state machine test controls -->
	<div class="fixed right-4 bottom-4 z-50 flex gap-2 rounded-lg border bg-card p-2 shadow-lg">
		<button
			class="rounded bg-primary px-3 py-1 text-xs text-primary-foreground"
			onclick={() => {
				debugActive = true;
				debugIndeterminate = true;
				debugValue = 0;
			}}>Loading</button
		>
		<button
			class="rounded bg-muted px-3 py-1 text-xs"
			onclick={() => {
				debugActive = true;
				debugIndeterminate = false;
				debugValue = 0;
			}}>0%</button
		>
		<button
			class="rounded bg-muted px-3 py-1 text-xs"
			onclick={() => {
				debugActive = true;
				debugIndeterminate = false;
				debugValue = 50;
			}}>50%</button
		>
		<button
			class="rounded bg-muted px-3 py-1 text-xs"
			onclick={() => {
				debugActive = true;
				debugIndeterminate = false;
				debugValue = 100;
			}}>100%</button
		>
	</div>
{/if}
