<script lang="ts">
	import { onMount } from 'svelte';
	import { T, getTranslate } from '@tolgee/svelte';
	import { resolve } from '$app/paths';
	import { localizedHref } from '$lib/utils/i18n';
	import { PASSWORD_MIN_LENGTH } from './schema.js';
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
		signUpData: {
			name: string;
			email: string;
			password: string;
		};
		signUpErrors: Record<string, string[]>;
		formError: string;
		isLoading: boolean;
		signUpProgress: number;
		hasOAuthAuth: boolean;
		oauthProviders:
			| {
					google?: boolean;
					github?: boolean;
			  }
			| undefined;
		redirectTo: string | undefined;
		isLastUsedAuthMethod: (method: LastAuthMethod) => boolean;
		onSubmit: (event: SubmitEvent) => void | Promise<void>;
		onOAuth: (provider: PendingOAuthProvider) => void | Promise<void>;
	};

	let {
		id,
		signUpData,
		signUpErrors,
		formError,
		isLoading,
		signUpProgress,
		hasOAuthAuth,
		oauthProviders,
		redirectTo,
		isLastUsedAuthMethod,
		onSubmit,
		onOAuth
	}: Props = $props();

	const { t } = getTranslate();
	let hydrated = $state(false);
	const isFormDisabled = $derived(isLoading || !hydrated);

	const passwordParams = {
		'validation.password.min_length': { count: PASSWORD_MIN_LENGTH }
	};

	onMount(() => {
		hydrated = true;
	});

	function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		void onSubmit(event);
	}
</script>

<form
	onsubmit={handleSubmit}
	action="/api/auth/sign-up/email"
	method="POST"
	novalidate
	class="min-h-96"
>
	<LoadingBar
		value={signUpProgress}
		mode={isLoading ? 'loading' : 'progress'}
		class="h-1 rounded-none"
	/>
	<div class="p-6 md:p-8">
		<Field.Group>
			<div class="flex flex-col items-center gap-2 text-center">
				<h1 class="text-2xl font-bold">
					<T keyName="auth.signup.title" defaultValue="Create an account" />
				</h1>
				<p class="text-balance text-muted-foreground">
					<T keyName="auth.signup.description" defaultValue="Enter your details to get started" />
				</p>
			</div>
			<Field.Field>
				<Field.Label for="name-{id}">
					<T keyName="auth.signin.name_label" defaultValue="Name" />
				</Field.Label>
				<Input
					id="name-{id}"
					name="name"
					type="text"
					autocomplete="name"
					placeholder="Your name"
					disabled={isFormDisabled}
					bind:value={signUpData.name}
				/>
				<Field.Error errors={translateValidationErrors(signUpErrors.name, $t)} />
			</Field.Field>
			<Field.Field>
				<Field.Label for="signup-email-{id}">
					<T keyName="auth.signin.email_label" />
				</Field.Label>
				<Input
					id="signup-email-{id}"
					name="username"
					type="email"
					autocomplete="username"
					placeholder="m@example.com"
					disabled={isFormDisabled}
					bind:value={signUpData.email}
				/>
				<Field.Error errors={translateValidationErrors(signUpErrors.email, $t)} />
			</Field.Field>
			<Field.Field>
				<Field.Label for="signup-password-{id}">
					<T keyName="auth.signin.password_label" />
				</Field.Label>
				<Password.Root>
					<Password.Input
						id="signup-password-{id}"
						name="password"
						autocomplete="new-password"
						disabled={isFormDisabled}
						bind:value={signUpData.password}
					>
						<Password.ToggleVisibility />
					</Password.Input>
					<Password.Strength />
				</Password.Root>
				<Field.Error
					errors={translateValidationErrors(signUpErrors.password, $t, passwordParams)}
				/>
			</Field.Field>
			<Field.Error errors={translateFormError(formError, $t)} data-testid="auth-error" />
			<Field.Field>
				<Button type="submit" class="w-full" disabled={isFormDisabled} data-testid="signup-button">
					{#if isLoading}
						<T keyName="auth.signin.button_signup_loading" />
					{:else}
						<T keyName="auth.signin.button_signup" />
					{/if}
				</Button>
			</Field.Field>
			{#if hasOAuthAuth}
				<Field.Separator class="*:data-[slot=field-separator-content]:bg-card">
					<T keyName="auth.signin.or_continue_with" />
				</Field.Separator>
				<Field.Field>
					<OAuthButtons
						mode="signup"
						providers={oauthProviders}
						isLoading={isFormDisabled}
						showPasskey={false}
						enabledProviderCount={(oauthProviders?.google ? 1 : 0) +
							(oauthProviders?.github ? 1 : 0)}
						{isLastUsedAuthMethod}
						{onOAuth}
					/>
				</Field.Field>
			{/if}
			<Field.Description class="text-center">
				<T keyName="auth.signup.has_account" defaultValue="Already have an account?" />
				<a
					href={resolve(
						localizedHref('/signin') +
							(redirectTo ? `?redirectTo=${encodeURIComponent(redirectTo)}` : '')
					)}
					class="underline underline-offset-4 active:translate-y-px"
				>
					<T keyName="auth.signup.link_signin" defaultValue="Sign in" />
				</a>
			</Field.Description>
		</Field.Group>
	</div>
</form>
