<script lang="ts">
	import * as v from 'valibot';
	import { authClient } from '$lib/auth-client';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { useQuery } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { redirectParamsSchema } from '$lib/schemas/auth.js';
	import { signInSchema } from './schema.js';
	import { localizedHref } from '$lib/utils/i18n';
	import { resolve } from '$app/paths';
	import { T, getTranslate } from '@tolgee/svelte';
	import { haptic } from '$lib/hooks/use-haptic.svelte';
	import { authFlow } from '$lib/hooks/auth-flow.svelte';
	import {
		type LastAuthMethod,
		type PendingOAuthProvider,
		lastSuccessfulAuthMethod,
		beginOAuth,
		clearPendingOAuthProvider,
		setLastSuccessfulAuthMethod,
		clearLastSuccessfulAuthMethod
	} from '$lib/hooks/last-auth-method.svelte';
	import { getAuthErrorKey } from '$lib/utils/auth-messages';
	import { safeRedirectPath } from '$lib/utils/url';
	import SignInForm from './SignInForm.svelte';
	import { useSearchParams } from 'runed/kit';

	let { data } = $props();

	const { t } = getTranslate();
	const auth = useAuth();
	const params = useSearchParams(redirectParamsSchema, {
		debounce: 300,
		pushHistory: false
	});
	const oauthProviders = useQuery(api.auth.getAvailableOAuthProviders, {}, () => ({
		initialData: data.oauthProviders
	}));

	// Passkey always available on signin, so alternative auth is always shown
	const hasAlternativeAuth = true;
	const enabledProviderCount = $derived(
		(oauthProviders.data?.google ? 1 : 0) + (oauthProviders.data?.github ? 1 : 0) + 1 // passkey
	);

	let isLoading = $state(false);
	let formError = $state('');
	let lastValidSignInSubmission = $state<string | null>(null);
	let termsLink = $state<HTMLAnchorElement | null>(null);

	const id = $props.id();

	let signInData = $state({ email: '', password: '' });
	let signInErrors = $state<Record<string, string[]>>({});

	function isLastUsedAuthMethod(method: LastAuthMethod): boolean {
		return lastSuccessfulAuthMethod.current === method;
	}

	const signInTotalSteps = 3;
	const signInValidation = $derived.by(() => {
		const result = v.safeParse(signInSchema, {
			email: signInData.email,
			_password: signInData.password
		});
		const invalidFields = new Set<string>(
			result.success
				? []
				: result.issues
						.map((issue) => issue.path?.[0]?.key)
						.filter((key): key is string => typeof key === 'string')
		);
		return {
			isEmailValid: !invalidFields.has('email'),
			isPasswordValid: !invalidFields.has('_password')
		};
	});
	const signInSubmissionToken = $derived(`${signInData.email}\u0000${signInData.password}`);
	const signInCompletedSteps = $derived(
		(signInValidation.isEmailValid ? 1 : 0) +
			(signInValidation.isPasswordValid ? 1 : 0) +
			(lastValidSignInSubmission === signInSubmissionToken ? 1 : 0)
	);
	const signInProgress = $derived((signInCompletedSteps / signInTotalSteps) * 100);

	// Initialize email from global state
	$effect(() => {
		if (authFlow.email) {
			signInData.email = authFlow.email;
		}
	});

	// Sync email changes to global state
	$effect(() => {
		if (signInData.email) {
			authFlow.email = signInData.email;
		}
	});

	// Redirect when authenticated
	$effect(() => {
		if (auth.isAuthenticated) {
			const destination = safeRedirectPath(params.redirectTo, localizedHref('/app'));
			window.location.href = destination;
		}
	});

	function validateSignIn(): boolean {
		const dataForValidation = {
			email: signInData.email,
			_password: signInData.password
		};
		const result = v.safeParse(signInSchema, dataForValidation);
		if (!result.success) {
			const errors: Record<string, string[]> = {};
			for (const issue of result.issues) {
				const path = issue.path?.[0]?.key as string;
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

	async function handleSignIn(e: Event) {
		e.preventDefault();
		if (!validateSignIn()) {
			lastValidSignInSubmission = null;
			return;
		}
		lastValidSignInSubmission = signInSubmissionToken;

		isLoading = true;

		try {
			let failed = false;
			await authClient.signIn.email(
				{ email: signInData.email, password: signInData.password },
				{
					onError: (ctx) => {
						failed = true;
						lastValidSignInSubmission = null;
						haptic.trigger('error');
						formError = getAuthErrorKey(ctx.error, 'auth.messages.invalid_credentials');
					}
				}
			);
			if (!failed) {
				haptic.trigger('success');
				clearLastSuccessfulAuthMethod();
				clearPendingOAuthProvider();
				window.location.href = safeRedirectPath(params.redirectTo, localizedHref('/app'));
				return;
			}
		} catch (error) {
			console.error('[SignIn] Login error:', error);
			haptic.trigger('error');
			lastValidSignInSubmission = null;
			formError = 'auth.messages.generic_error';
		} finally {
			isLoading = false;
		}
	}

	async function handleOAuth(provider: PendingOAuthProvider) {
		haptic.trigger('light');
		isLoading = true;
		formError = '';
		beginOAuth(provider);

		try {
			await authClient.signIn.social({
				provider,
				callbackURL: safeRedirectPath(params.redirectTo, localizedHref('/app'))
			});
		} catch (error) {
			clearPendingOAuthProvider();
			console.error(`[SignIn] OAuth ${provider} error:`, error);
			formError = 'auth.messages.oauth_failed';
		} finally {
			isLoading = false;
		}
	}

	async function handlePasskeyLogin() {
		haptic.trigger('light');
		isLoading = true;
		formError = '';

		try {
			const result = await authClient.signIn.passkey();
			if (result.error) {
				formError = getAuthErrorKey(result.error, 'auth.messages.passkey_failed');
			} else {
				setLastSuccessfulAuthMethod('passkey');
				clearPendingOAuthProvider();
			}
		} catch (error) {
			console.error('[SignIn] Passkey login error:', error);
			formError = 'auth.messages.passkey_failed';
		} finally {
			isLoading = false;
		}
	}
</script>

<SEOHead title={$t('meta.auth.signin.title')} description={$t('meta.auth.signin.description')} />

<noscript>
	<div class="fixed inset-x-0 top-0 z-50 bg-yellow-100 p-4 text-center text-yellow-800">
		JavaScript is required for authentication. Please enable JavaScript to sign in.
	</div>
</noscript>

<div class="flex min-h-svh flex-col items-center justify-center p-6 md:p-10">
	<div class="flex w-full max-w-sm flex-col gap-6 md:max-w-3xl">
		<Card.Root class="overflow-hidden p-0">
			<Card.Content class="grid p-0 md:grid-cols-2">
				<SignInForm
					{id}
					{signInData}
					{signInErrors}
					{formError}
					{isLoading}
					{signInProgress}
					{hasAlternativeAuth}
					{enabledProviderCount}
					oauthProviders={oauthProviders.data}
					redirectTo={params.redirectTo}
					{termsLink}
					{isLastUsedAuthMethod}
					onSubmit={handleSignIn}
					onOAuth={handleOAuth}
					onPasskey={handlePasskeyLogin}
				/>
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
		<Field.Description class="px-6 text-center">
			<T keyName="auth.terms.agreement" defaultValue="By clicking continue, you agree to our" />
			<a
				bind:this={termsLink}
				href={resolve(localizedHref('/terms'))}
				class="underline underline-offset-4 active:translate-y-px"
				><T keyName="auth.terms.terms_of_service" defaultValue="Terms of Service" /></a
			>
			<T keyName="auth.terms.and" defaultValue="and" />
			<a
				href={resolve(localizedHref('/privacy'))}
				class="underline underline-offset-4 active:translate-y-px"
				><T keyName="auth.terms.privacy_policy" defaultValue="Privacy Policy" /></a
			>.
			<a
				href={resolve(localizedHref('/'))}
				class="underline underline-offset-4 active:translate-y-px"
				><T keyName="auth.back_to_home" defaultValue="Back to home" /></a
			>
		</Field.Description>
	</div>
</div>
