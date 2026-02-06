<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- Query-string-only hrefs don't need resolve() */
	import * as v from 'valibot';
	import { authClient } from '$lib/auth-client';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { useQuery } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import {
		FieldGroup,
		Field,
		FieldLabel,
		FieldDescription,
		FieldSeparator,
		FieldError
	} from '$lib/components/ui/field/index.js';
	import { useSearchParams } from 'runed/kit';
	import { authParamsSchema } from '$lib/schemas/auth.js';
	import { PASSWORD_MIN_LENGTH, signInSchema, signUpSchema } from './schema.js';
	import { localizedHref } from '$lib/utils/i18n';
	import { resolve } from '$app/paths';
	import { T, getTranslate } from '@tolgee/svelte';
	import KeyIcon from '@lucide/svelte/icons/key-round';
	import { authFlow } from '$lib/hooks/auth-flow.svelte';
	import { getAuthErrorKey } from '$lib/utils/auth-messages';
	import { translateValidationErrors, translateFormError } from '$lib/utils/validation-i18n.js';
	import { safeRedirectPath } from '$lib/utils/url';

	let { data } = $props();

	const { t } = getTranslate();
	const auth = useAuth();
	const params = useSearchParams(authParamsSchema, {
		debounce: 300,
		pushHistory: false
	});
	const oauthProviders = useQuery(api.auth.getAvailableOAuthProviders, {}, () => ({
		initialData: data.oauthProviders
	}));

	// Passkeys are only available on signin tab
	const hasPasskeyAuth = $derived(params.tab === 'signin');
	// OAuth providers are available on both tabs
	const hasOAuthAuth = $derived(
		Boolean(oauthProviders.data?.google || oauthProviders.data?.github)
	);
	// Show alternative auth section if any alternative is available
	const hasAlternativeAuth = $derived(hasPasskeyAuth || hasOAuthAuth);

	// Count enabled providers for grid columns
	const enabledProviderCount = $derived(
		(oauthProviders.data?.google ? 1 : 0) +
			(oauthProviders.data?.github ? 1 : 0) +
			(params.tab === 'signin' ? 1 : 0) // passkey
	);

	let isLoading = $state(false);
	let formError = $state('');
	let verificationStep = $state<{ email: string } | null>(null);

	const id = $props.id();

	// Form data
	let signInData = $state({ email: '', password: '' });
	let signUpData = $state({ name: '', email: '', password: '' });

	// Field errors (keyed by field name)
	let signInErrors = $state<Record<string, string[]>>({});
	let signUpErrors = $state<Record<string, string[]>>({});

	// Translation params for password min_length validation
	const passwordParams = {
		'validation.password.min_length': { count: PASSWORD_MIN_LENGTH }
	};

	// Initialize email from global state
	$effect(() => {
		if (authFlow.email) {
			signInData.email = authFlow.email;
			signUpData.email = authFlow.email;
		}
	});

	// Sync email changes to global state and between forms
	$effect(() => {
		const email = params.tab === 'signin' ? signInData.email : signUpData.email;
		if (email) {
			authFlow.email = email;
		}
		// Sync between forms
		if (params.tab === 'signin' && signInData.email !== signUpData.email) {
			signUpData.email = signInData.email;
		} else if (params.tab === 'signup' && signUpData.email !== signInData.email) {
			signInData.email = signUpData.email;
		}
	});

	// Redirect when authenticated on signin page (but not during verification step)
	$effect(() => {
		if (auth.isAuthenticated && !verificationStep) {
			const destination = safeRedirectPath(params.redirectTo, localizedHref('/app'));
			window.location.href = destination;
		}
	});

	function validateSignIn(): boolean {
		// Map form data to schema field names (_password)
		const dataForValidation = {
			email: signInData.email,
			_password: signInData.password
		};
		const result = v.safeParse(signInSchema, dataForValidation);
		if (!result.success) {
			const errors: Record<string, string[]> = {};
			for (const issue of result.issues) {
				const path = issue.path?.[0]?.key as string;
				// Map _password back to password for display
				const fieldName = path === '_password' ? 'password' : path;
				if (!errors[fieldName]) errors[fieldName] = [];
				errors[fieldName].push(issue.message);
			}
			signInErrors = errors;
			return false;
		}
		signInErrors = {};
		return true;
	}

	function validateSignUp(): boolean {
		// Map form data to schema field names (_password)
		const dataForValidation = {
			name: signUpData.name,
			email: signUpData.email,
			_password: signUpData.password
		};
		const result = v.safeParse(signUpSchema, dataForValidation);
		if (!result.success) {
			const errors: Record<string, string[]> = {};
			for (const issue of result.issues) {
				const path = issue.path?.[0]?.key as string;
				// Map _password back to password for display
				const fieldName = path === '_password' ? 'password' : path;
				if (!errors[fieldName]) errors[fieldName] = [];
				errors[fieldName].push(issue.message);
			}
			signUpErrors = errors;
			return false;
		}
		signUpErrors = {};
		return true;
	}

	async function handleSignIn(e: Event) {
		e.preventDefault();
		if (!validateSignIn()) return;

		isLoading = true;
		formError = '';

		try {
			await authClient.signIn.email(
				{ email: signInData.email, password: signInData.password },
				{
					onError: (ctx) => {
						formError = getAuthErrorKey(ctx.error, 'auth.messages.invalid_credentials');
					}
				}
			);
		} catch (error) {
			console.error('[SignIn] Login error:', error);
			formError = 'auth.messages.invalid_credentials';
		} finally {
			isLoading = false;
		}
	}

	async function handleSignUp(e: Event) {
		e.preventDefault();
		if (!validateSignUp()) return;

		isLoading = true;
		formError = '';

		try {
			// After email verification, route through interstitial page before final destination
			const finalDestination = params.redirectTo || localizedHref('/app');
			const callbackURL =
				localizedHref('/email-verified') + `?redirectTo=${encodeURIComponent(finalDestination)}`;
			await authClient.signUp.email(
				{
					email: signUpData.email,
					password: signUpData.password,
					name: signUpData.name,
					callbackURL
				},
				{
					onSuccess: () => {
						verificationStep = { email: signUpData.email };
					},
					onError: (ctx) => {
						formError = getAuthErrorKey(ctx.error, 'auth.messages.signup_failed');
					}
				}
			);
		} catch (error) {
			console.error('[SignUp] Registration error:', error);
			formError = 'auth.messages.signup_failed';
		} finally {
			isLoading = false;
		}
	}

	function cancelVerification() {
		verificationStep = null;
		formError = '';
	}

	async function handleOAuth(provider: 'google' | 'github') {
		try {
			await authClient.signIn.social({
				provider,
				callbackURL: safeRedirectPath(params.redirectTo, localizedHref('/app'))
			});
		} catch (error) {
			console.error(`[SignIn] OAuth ${provider} error:`, error);
			formError = 'auth.messages.oauth_failed';
		}
	}

	async function handlePasskeyLogin() {
		isLoading = true;
		formError = '';

		try {
			const result = await authClient.signIn.passkey();
			if (result.error) {
				formError = getAuthErrorKey(result.error, 'auth.messages.passkey_failed');
			}
		} catch (error) {
			console.error('[SignIn] Passkey login error:', error);
			formError = 'auth.messages.passkey_failed';
		} finally {
			isLoading = false;
		}
	}
</script>

<noscript>
	<div class="fixed inset-x-0 top-0 z-50 bg-yellow-100 p-4 text-center text-yellow-800">
		JavaScript is required for authentication. Please enable JavaScript to sign in.
	</div>
</noscript>

<div class="flex min-h-svh flex-col items-center justify-center p-6 md:p-10">
	<div class="flex w-full max-w-sm flex-col gap-6 md:max-w-3xl">
		<Card.Root class="overflow-hidden p-0">
			<Card.Content class="grid p-0 md:grid-cols-2">
				{#if verificationStep}
					<!-- Email Verification Step -->
					<div class="p-6 md:p-8">
						<FieldGroup>
							<div class="flex flex-col items-center gap-2 text-center">
								<h1 class="text-2xl font-bold">
									<T keyName="auth.verification.title" />
								</h1>
								<p class="text-balance text-muted-foreground">
									<T keyName="auth.verification.description" />
								</p>
							</div>
							<Field>
								<p class="text-sm text-muted-foreground">
									<T keyName="auth.verification.sent_to" />
									<span class="font-medium">{verificationStep.email}</span>
								</p>
							</Field>
							<Field>
								<p class="text-sm text-muted-foreground">
									<T keyName="auth.verification.check_email" />
								</p>
							</Field>
							{#if formError}
								<Field>
									<FieldError errors={translateFormError(formError, $t)} />
								</Field>
							{/if}
							<Field>
								<Button type="button" variant="ghost" class="w-full" onclick={cancelVerification}>
									<T keyName="auth.verification.button_back" />
								</Button>
							</Field>
						</FieldGroup>
					</div>
				{:else if params.tab === 'signin'}
					<!-- Sign In Form -->
					<form onsubmit={handleSignIn} novalidate class="p-6 md:p-8">
						<FieldGroup>
							<div class="flex flex-col items-center gap-2 text-center">
								<h1 class="text-2xl font-bold">
									<T keyName="auth.signin.title" />
								</h1>
								<p class="text-balance text-muted-foreground">
									<T keyName="auth.signin.description" />
								</p>
							</div>
							<Field>
								<FieldLabel for="email-{id}"><T keyName="auth.signin.email_label" /></FieldLabel>
								<Input
									id="email-{id}"
									data-testid="email-input"
									type="email"
									placeholder="m@example.com"
									disabled={isLoading}
									bind:value={signInData.email}
								/>
								<FieldError errors={translateValidationErrors(signInErrors.email, $t)} />
							</Field>
							<Field>
								<div class="flex items-center">
									<FieldLabel for="password-{id}"
										><T keyName="auth.signin.password_label" /></FieldLabel
									>
									<a
										href={resolve(localizedHref('/forgot-password'))}
										class="ms-auto text-sm text-muted-foreground underline-offset-2 hover:underline"
									>
										<T keyName="auth.signin.forgot_password" />
									</a>
								</div>
								<Input
									id="password-{id}"
									data-testid="password-input"
									type="password"
									disabled={isLoading}
									bind:value={signInData.password}
								/>
								<FieldError errors={translateValidationErrors(signInErrors.password, $t)} />
							</Field>
							<FieldError errors={translateFormError(formError, $t)} data-testid="auth-error" />
							<Field>
								<Button
									type="submit"
									class="w-full"
									disabled={isLoading}
									data-testid="signin-button"
								>
									{#if isLoading}
										<T keyName="auth.signin.button_signin_loading" />
									{:else}
										<T keyName="auth.signin.button_signin" />
									{/if}
								</Button>
							</Field>
							{#if hasAlternativeAuth}
								<FieldSeparator class="*:data-[slot=field-separator-content]:bg-card">
									<T keyName="auth.signin.or_continue_with" />
								</FieldSeparator>
								<Field
									class="grid gap-4"
									style="grid-template-columns: repeat({enabledProviderCount}, minmax(0, 1fr));"
								>
									{#if oauthProviders.data?.google}
										<Button variant="outline" type="button" onclick={() => handleOAuth('google')}>
											<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
												<path
													d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
													fill="currentColor"
												/>
											</svg>
											<span class="sr-only"><T keyName="auth.signin.oauth_google" /></span>
										</Button>
									{/if}
									{#if oauthProviders.data?.github}
										<Button variant="outline" type="button" onclick={() => handleOAuth('github')}>
											<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
												<path
													d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
													fill="currentColor"
												/>
											</svg>
											<span class="sr-only"><T keyName="auth.signin.oauth_github" /></span>
										</Button>
									{/if}
									<Button
										variant="outline"
										type="button"
										onclick={handlePasskeyLogin}
										disabled={isLoading}
									>
										<KeyIcon class="h-4 w-4" />
										<span class="sr-only"
											><T
												keyName="auth.signin.passkey_button"
												defaultValue="Sign in with Passkey"
											/></span
										>
									</Button>
								</Field>
							{/if}
							<FieldDescription class="text-center">
								<T keyName="auth.signin.no_account" defaultValue="Don't have an account?" />
								<a
									href="?tab=signup{params.redirectTo
										? `&redirectTo=${encodeURIComponent(params.redirectTo)}`
										: ''}"
									class="underline underline-offset-4"
									><T keyName="auth.signin.link_signup" defaultValue="Sign up" /></a
								>
							</FieldDescription>
						</FieldGroup>
					</form>
				{:else}
					<!-- Sign Up Form -->
					<form onsubmit={handleSignUp} novalidate class="p-6 md:p-8">
						<FieldGroup>
							<div class="flex flex-col items-center gap-2 text-center">
								<h1 class="text-2xl font-bold">
									<T keyName="auth.signup.title" defaultValue="Create an account" />
								</h1>
								<p class="text-balance text-muted-foreground">
									<T
										keyName="auth.signup.description"
										defaultValue="Enter your details to get started"
									/>
								</p>
							</div>
							<Field>
								<FieldLabel for="name-{id}"
									><T keyName="auth.signin.name_label" defaultValue="Name" /></FieldLabel
								>
								<Input
									id="name-{id}"
									type="text"
									placeholder="Your name"
									disabled={isLoading}
									bind:value={signUpData.name}
								/>
								<FieldError errors={translateValidationErrors(signUpErrors.name, $t)} />
							</Field>
							<Field>
								<FieldLabel for="signup-email-{id}"
									><T keyName="auth.signin.email_label" /></FieldLabel
								>
								<Input
									id="signup-email-{id}"
									type="email"
									placeholder="m@example.com"
									disabled={isLoading}
									bind:value={signUpData.email}
								/>
								<FieldError errors={translateValidationErrors(signUpErrors.email, $t)} />
							</Field>
							<Field>
								<FieldLabel for="signup-password-{id}"
									><T keyName="auth.signin.password_label" /></FieldLabel
								>
								<Input
									id="signup-password-{id}"
									type="password"
									disabled={isLoading}
									bind:value={signUpData.password}
								/>
								<FieldDescription>
									<T
										keyName="auth.signup.password_hint"
										defaultValue="Minimum 10 characters with uppercase, lowercase, and number"
									/>
								</FieldDescription>
								<FieldError
									errors={translateValidationErrors(signUpErrors.password, $t, passwordParams)}
								/>
							</Field>
							<FieldError errors={translateFormError(formError, $t)} data-testid="auth-error" />
							<Field>
								<Button
									type="submit"
									class="w-full"
									disabled={isLoading}
									data-testid="signup-button"
								>
									{#if isLoading}
										<T keyName="auth.signin.button_signup_loading" />
									{:else}
										<T keyName="auth.signin.button_signup" />
									{/if}
								</Button>
							</Field>
							{#if hasOAuthAuth}
								<FieldSeparator class="*:data-[slot=field-separator-content]:bg-card">
									<T keyName="auth.signin.or_continue_with" />
								</FieldSeparator>
								<Field
									class="grid gap-4"
									style="grid-template-columns: repeat({(oauthProviders.data?.google ? 1 : 0) +
										(oauthProviders.data?.github ? 1 : 0)}, minmax(0, 1fr));"
								>
									{#if oauthProviders.data?.google}
										<Button variant="outline" type="button" onclick={() => handleOAuth('google')}>
											<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
												<path
													d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
													fill="currentColor"
												/>
											</svg>
											<span class="sr-only"><T keyName="auth.signin.oauth_google" /></span>
										</Button>
									{/if}
									{#if oauthProviders.data?.github}
										<Button variant="outline" type="button" onclick={() => handleOAuth('github')}>
											<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
												<path
													d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
													fill="currentColor"
												/>
											</svg>
											<span class="sr-only"><T keyName="auth.signin.oauth_github" /></span>
										</Button>
									{/if}
								</Field>
							{/if}
							<FieldDescription class="text-center">
								<T keyName="auth.signup.has_account" defaultValue="Already have an account?" />
								<a
									href="?tab=signin{params.redirectTo
										? `&redirectTo=${encodeURIComponent(params.redirectTo)}`
										: ''}"
									class="underline underline-offset-4"
									><T keyName="auth.signup.link_signin" defaultValue="Sign in" /></a
								>
							</FieldDescription>
						</FieldGroup>
					</form>
				{/if}
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
