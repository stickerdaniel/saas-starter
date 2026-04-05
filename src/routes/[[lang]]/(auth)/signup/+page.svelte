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
	import { signUpSchema } from '../signin/schema.js';
	import { localizedHref } from '$lib/utils/i18n';
	import { resolve } from '$app/paths';
	import { T, getTranslate } from '@tolgee/svelte';
	import { haptic } from '$lib/hooks/use-haptic.svelte';
	import { authFlow } from '$lib/hooks/auth-flow.svelte';
	import {
		type PendingOAuthProvider,
		lastSuccessfulAuthMethod,
		beginOAuth,
		clearPendingOAuthProvider,
		clearLastSuccessfulAuthMethod,
		type LastAuthMethod
	} from '$lib/hooks/last-auth-method.svelte';
	import { getAuthErrorKey } from '$lib/utils/auth-messages';
	import { safeRedirectPath } from '$lib/utils/url';
	import SignUpForm from '../signin/SignUpForm.svelte';
	import VerificationStep from '../signin/VerificationStep.svelte';
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

	const hasOAuthAuth = $derived(
		Boolean(oauthProviders.data?.google || oauthProviders.data?.github)
	);

	let isLoading = $state(false);
	let formError = $state('');
	let verificationStep = $state<{ email: string } | null>(null);
	let lastValidSignUpSubmission = $state<string | null>(null);

	const id = $props.id();

	let signUpData = $state({ name: '', email: '', password: '' });
	let signUpErrors = $state<Record<string, string[]>>({});

	function isLastUsedAuthMethod(method: LastAuthMethod): boolean {
		return lastSuccessfulAuthMethod.current === method;
	}

	const signUpTotalSteps = 4;
	const signUpValidation = $derived.by(() => {
		const result = v.safeParse(signUpSchema, {
			name: signUpData.name,
			email: signUpData.email,
			_password: signUpData.password
		});
		const invalidFields = new Set<string>(
			result.success
				? []
				: result.issues
						.map((issue) => issue.path?.[0]?.key)
						.filter((key): key is string => typeof key === 'string')
		);
		return {
			isNameValid: !invalidFields.has('name'),
			isEmailValid: !invalidFields.has('email'),
			isPasswordValid: !invalidFields.has('_password')
		};
	});
	const signUpSubmissionToken = $derived(
		`${signUpData.name}\u0000${signUpData.email}\u0000${signUpData.password}`
	);
	const signUpCompletedSteps = $derived(
		(signUpValidation.isNameValid ? 1 : 0) +
			(signUpValidation.isEmailValid ? 1 : 0) +
			(signUpValidation.isPasswordValid ? 1 : 0) +
			(lastValidSignUpSubmission === signUpSubmissionToken ? 1 : 0)
	);
	const signUpProgress = $derived((signUpCompletedSteps / signUpTotalSteps) * 100);

	// Initialize email from global state
	$effect(() => {
		if (authFlow.email) {
			signUpData.email = authFlow.email;
		}
	});

	// Sync email changes to global state
	$effect(() => {
		if (signUpData.email) {
			authFlow.email = signUpData.email;
		}
	});

	// Redirect when authenticated (but not during verification step)
	$effect(() => {
		if (auth.isAuthenticated && !verificationStep) {
			const destination = safeRedirectPath(params.redirectTo, localizedHref('/app'));
			window.location.href = destination;
		}
	});

	function validateSignUp(): boolean {
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

	async function handleSignUp(e: Event) {
		e.preventDefault();
		if (!validateSignUp()) {
			lastValidSignUpSubmission = null;
			return;
		}
		lastValidSignUpSubmission = signUpSubmissionToken;

		isLoading = true;

		try {
			let failed = false;
			const finalDestination = safeRedirectPath(params.redirectTo, localizedHref('/app'));
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
						haptic.trigger('success');
						clearLastSuccessfulAuthMethod();
						clearPendingOAuthProvider();
						formError = '';
						verificationStep = { email: signUpData.email };
					},
					onError: (ctx) => {
						failed = true;
						lastValidSignUpSubmission = null;
						haptic.trigger('error');
						formError = getAuthErrorKey(ctx.error, 'auth.messages.signup_failed');
					}
				}
			);
			if (failed) {
				lastValidSignUpSubmission = null;
			}
		} catch (error) {
			console.error('[SignUp] Registration error:', error);
			lastValidSignUpSubmission = null;
			formError = 'auth.messages.signup_failed';
		} finally {
			isLoading = false;
		}
	}

	function cancelVerification() {
		verificationStep = null;
		formError = '';
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
			console.error(`[SignUp] OAuth ${provider} error:`, error);
			formError = 'auth.messages.oauth_failed';
		} finally {
			isLoading = false;
		}
	}
</script>

<SEOHead title={$t('meta.auth.signup.title')} description={$t('meta.auth.signup.description')} />

<noscript>
	<div class="fixed inset-x-0 top-0 z-50 bg-yellow-100 p-4 text-center text-yellow-800">
		JavaScript is required for authentication. Please enable JavaScript to sign up.
	</div>
</noscript>

<div class="flex min-h-svh flex-col items-center justify-center p-6 md:p-10">
	<div class="flex w-full max-w-sm flex-col gap-6 md:max-w-3xl">
		<Card.Root class="overflow-hidden p-0">
			<Card.Content class="grid p-0 md:grid-cols-2">
				{#if verificationStep}
					<VerificationStep
						email={verificationStep.email}
						{formError}
						onBack={cancelVerification}
					/>
				{:else}
					<SignUpForm
						{id}
						{signUpData}
						{signUpErrors}
						{formError}
						{isLoading}
						{signUpProgress}
						{hasOAuthAuth}
						oauthProviders={oauthProviders.data}
						redirectTo={params.redirectTo}
						{isLastUsedAuthMethod}
						onSubmit={handleSignUp}
						onOAuth={handleOAuth}
					/>
				{/if}
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
