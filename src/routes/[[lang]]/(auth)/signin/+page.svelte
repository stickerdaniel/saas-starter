<script lang="ts">
	import { authClient } from '$lib/auth-client';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { useQuery } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs/index.js';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card/index.js';
	import { useSearchParams } from 'runed/kit';
	import {
		authParamsSchema,
		signInSchema,
		signUpSchema,
		PASSWORD_MIN_LENGTH
	} from '$lib/schemas/auth.js';
	import { localizedHref } from '$lib/utils/i18n';
	import { T } from '@tolgee/svelte';
	import KeyIcon from '@lucide/svelte/icons/key-round';
	import { authFlow } from '$lib/hooks/auth-flow.svelte';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';

	const auth = useAuth();
	const params = useSearchParams(authParamsSchema, {
		debounce: 300,
		pushHistory: false
	});
	const oauthProviders = useQuery(api.auth.getAvailableOAuthProviders, {});

	// Passkeys are only available on signin tab
	const hasPasskeyAuth = $derived(params.tab === 'signin');
	// OAuth providers are available on both tabs
	const hasOAuthAuth = $derived(
		Boolean(oauthProviders.data?.google || oauthProviders.data?.github)
	);
	// Show alternative auth section if any alternative is available
	const hasAlternativeAuth = $derived(hasPasskeyAuth || hasOAuthAuth);

	let isLoading = $state(false);
	let formError = $state('');
	let verificationStep = $state<{ email: string } | null>(null);

	// Sign In Form
	const signInForm = superForm(defaults({ email: '', password: '' }, zod4(signInSchema)), {
		validators: zod4(signInSchema),
		SPA: true,
		onUpdate: async ({ form: f }) => {
			if (!f.valid) return;
			isLoading = true;
			formError = '';

			try {
				await authClient.signIn.email(
					{ email: f.data.email, password: f.data.password },
					{
						onError: (ctx) => {
							formError = ctx.error.message || 'auth.errors.invalid_credentials';
						}
					}
				);
			} catch {
				formError = 'auth.errors.invalid_credentials';
			} finally {
				isLoading = false;
			}
		}
	});

	// Sign Up Form
	const signUpForm = superForm(
		defaults({ name: '', email: '', password: '' }, zod4(signUpSchema)),
		{
			validators: zod4(signUpSchema),
			SPA: true,
			onUpdate: async ({ form: f }) => {
				if (!f.valid) return;
				isLoading = true;
				formError = '';

				try {
					await authClient.signUp.email(
						{ email: f.data.email, password: f.data.password, name: f.data.name },
						{
							onSuccess: () => {
								verificationStep = { email: f.data.email };
							},
							onError: (ctx) => {
								formError = ctx.error.message || 'auth.errors.signup_failed';
							}
						}
					);
				} catch {
					formError = 'auth.errors.signup_failed';
				} finally {
					isLoading = false;
				}
			}
		}
	);

	const { form: signInData, enhance: signInEnhance } = signInForm;
	const { form: signUpData, enhance: signUpEnhance } = signUpForm;

	// Initialize email from global state
	$effect(() => {
		if (authFlow.email) {
			$signInData.email = authFlow.email;
			$signUpData.email = authFlow.email;
		}
	});

	// Sync email changes to global state and between forms
	$effect(() => {
		const email = params.tab === 'signin' ? $signInData.email : $signUpData.email;
		if (email) {
			authFlow.email = email;
		}
		// Sync between forms
		if (params.tab === 'signin' && $signInData.email !== $signUpData.email) {
			$signUpData.email = $signInData.email;
		} else if (params.tab === 'signup' && $signUpData.email !== $signInData.email) {
			$signInData.email = $signUpData.email;
		}
	});

	// Redirect when authenticated on signin page (but not during verification step)
	$effect(() => {
		if (auth.isAuthenticated && !verificationStep) {
			const destination = params.redirectTo || localizedHref('/app');
			window.location.href = destination;
		}
	});

	function cancelVerification() {
		verificationStep = null;
		formError = '';
	}

	async function handleOAuth(provider: 'google' | 'github') {
		await authClient.signIn.social({
			provider,
			callbackURL: params.redirectTo || localizedHref('/app')
		});
	}

	async function handlePasskeyLogin() {
		isLoading = true;
		formError = '';

		try {
			const result = await authClient.signIn.passkey();
			if (result.error) {
				formError = result.error.message || 'auth.errors.passkey_failed';
			}
		} catch {
			formError = 'auth.errors.passkey_failed';
		} finally {
			isLoading = false;
		}
	}
</script>

<div class="flex min-h-screen w-full">
	<main class="mx-auto my-auto flex flex-col">
		<Card class="w-[400px]">
			<CardHeader>
				<CardTitle>
					{#if verificationStep}
						<T keyName="auth.verification.title" />
					{:else}
						<T keyName="auth.signin.title" />
					{/if}
				</CardTitle>
				<CardDescription>
					{#if verificationStep}
						<T keyName="auth.verification.description" />
					{:else}
						<T keyName="auth.signin.description" />
					{/if}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{#if verificationStep}
					<!-- Email Verification Step - Link-based verification -->
					<div class="space-y-4">
						<p class="text-sm text-muted-foreground">
							<T keyName="auth.verification.sent_to" />
							<span class="font-medium">{verificationStep.email}</span>
						</p>
						<p class="text-sm text-muted-foreground">
							<T keyName="auth.verification.check_email" />
						</p>
						{#if formError}
							<p class="text-sm text-red-500">{formError}</p>
						{/if}
						<Button type="button" variant="ghost" class="w-full" onclick={cancelVerification}>
							<T keyName="auth.verification.button_cancel" />
						</Button>
					</div>
				{:else}
					<!-- Sign In / Sign Up Forms -->
					<Tabs bind:value={params.tab} class="w-full">
						<TabsList class="grid w-full grid-cols-2">
							<TabsTrigger value="signin"><T keyName="auth.signin.tab_signin" /></TabsTrigger>
							<TabsTrigger value="signup"><T keyName="auth.signin.tab_signup" /></TabsTrigger>
						</TabsList>

						<TabsContent value="signin">
							<form method="POST" use:signInEnhance class="space-y-4">
								<Form.Field form={signInForm} name="email">
									<Form.Control>
										{#snippet children({ props })}
											<Form.Label><T keyName="auth.signin.email_label" /></Form.Label>
											<Input
												{...props}
												data-testid="email-input"
												type="email"
												placeholder="you@example.com"
												disabled={isLoading}
												bind:value={$signInData.email}
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

								<Form.Field form={signInForm} name="password">
									<Form.Control>
										{#snippet children({ props })}
											<div class="flex items-center justify-between">
												<Form.Label><T keyName="auth.signin.password_label" /></Form.Label>
												<a
													href={localizedHref('/forgot-password')}
													class="text-sm text-muted-foreground hover:underline"
												>
													<T
														keyName="auth.signin.forgot_password"
														defaultValue="Forgot password?"
													/>
												</a>
											</div>
											<Input
												{...props}
												data-testid="password-input"
												type="password"
												placeholder="••••••••"
												disabled={isLoading}
												bind:value={$signInData.password}
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

								{#if formError}
									<p class="text-sm text-red-500" data-testid="auth-error">{formError}</p>
								{/if}

								<Form.Button class="w-full" disabled={isLoading} data-testid="signin-button">
									{#if isLoading}
										<T keyName="auth.signin.button_signin_loading" />
									{:else}
										<T keyName="auth.signin.button_signin" />
									{/if}
								</Form.Button>
							</form>
						</TabsContent>

						<TabsContent value="signup">
							<form method="POST" use:signUpEnhance class="space-y-4">
								<Form.Field form={signUpForm} name="name">
									<Form.Control>
										{#snippet children({ props })}
											<Form.Label
												><T keyName="auth.signin.name_label" defaultValue="Name" /></Form.Label
											>
											<Input
												{...props}
												type="text"
												placeholder="Your name"
												disabled={isLoading}
												bind:value={$signUpData.name}
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

								<Form.Field form={signUpForm} name="email">
									<Form.Control>
										{#snippet children({ props })}
											<Form.Label><T keyName="auth.signin.email_label" /></Form.Label>
											<Input
												{...props}
												type="email"
												placeholder="you@example.com"
												disabled={isLoading}
												bind:value={$signUpData.email}
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

								<Form.Field form={signUpForm} name="password">
									<Form.Control>
										{#snippet children({ props })}
											<Form.Label><T keyName="auth.signin.password_label" /></Form.Label>
											<Input
												{...props}
												type="password"
												placeholder="••••••••"
												disabled={isLoading}
												bind:value={$signUpData.password}
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

								{#if formError}
									<p class="text-sm text-red-500" data-testid="auth-error">{formError}</p>
								{/if}

								<Form.Button class="w-full" disabled={isLoading} data-testid="signup-button">
									{#if isLoading}
										<T keyName="auth.signin.button_signup_loading" />
									{:else}
										<T keyName="auth.signin.button_signup" />
									{/if}
								</Form.Button>
							</form>
						</TabsContent>
					</Tabs>
				{/if}

				{#if !verificationStep && hasAlternativeAuth}
					<div class="relative my-6">
						<div class="absolute inset-0 flex items-center">
							<span class="w-full border-t"></span>
						</div>
						<div class="relative flex justify-center text-xs uppercase">
							<span class="bg-card px-2 text-muted-foreground">
								<T keyName="auth.signin.or_continue_with" />
							</span>
						</div>
					</div>

					<div class="space-y-2">
						<!-- Passkey Login - Only show on signin tab -->
						{#if params.tab === 'signin'}
							<Button
								onclick={handlePasskeyLogin}
								variant="outline"
								class="w-full"
								disabled={isLoading}
							>
								<KeyIcon class="mr-2 h-4 w-4" />
								<T keyName="auth.signin.passkey_button" defaultValue="Sign in with Passkey" />
							</Button>
						{/if}

						{#if oauthProviders.data?.github}
							<Button onclick={() => handleOAuth('github')} variant="outline" class="w-full">
								<svg class="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
									<path
										d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
									/>
								</svg>
								<T keyName="auth.signin.oauth_github" />
							</Button>
						{/if}
						{#if oauthProviders.data?.google}
							<Button onclick={() => handleOAuth('google')} variant="outline" class="w-full">
								<svg class="mr-2 h-4 w-4" viewBox="0 0 24 24">
									<path
										fill="#4285F4"
										d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
									/>
									<path
										fill="#34A853"
										d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
									/>
									<path
										fill="#FBBC05"
										d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
									/>
									<path
										fill="#EA4335"
										d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
									/>
								</svg>
								<T keyName="auth.signin.oauth_google" />
							</Button>
						{/if}
					</div>
				{/if}

				{#if !verificationStep}
					<div class="mt-6 text-center">
						<a class="text-sm text-muted-foreground hover:underline" href={localizedHref('/')}>
							<T keyName="auth.signin.cancel" />
						</a>
					</div>
				{/if}
			</CardContent>
		</Card>
	</main>
</div>
