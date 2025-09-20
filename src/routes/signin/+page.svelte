<script lang="ts">
	import { useAuth } from '@mmailaender/convex-auth-svelte/sveltekit';
	import { goto } from '$app/navigation';
	import { env } from '$env/dynamic/public';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs/index.js';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card/index.js';

	const { signIn } = useAuth();

	let isLoading = false;
	let error = '';
	let verificationStep: { email: string } | null = null;
	let activeTab = 'signin';

	async function handleEmailAuth(event: Event, flow: 'signIn' | 'signUp') {
		event.preventDefault();
		isLoading = true;
		error = '';

		const formData = new FormData(event.currentTarget as HTMLFormElement);
		const email = formData.get('email') as string;
		const password = formData.get('password');

		try {
			// Critical: Use 'password' as provider and include flow parameter
			const result = await signIn('password', {
				email,
				password,
				flow, // 'signIn' or 'signUp'
				redirectTo: '/product'
			});

			if (result.signingIn) {
				// User is signed in
				goto('/product');
			} else if (flow === 'signUp') {
				// Email verification required for sign-up
				verificationStep = { email };
			}
		} catch (err) {
			error =
				flow === 'signIn'
					? 'Invalid email or password'
					: 'Failed to create account. Email may already be in use.';
			console.error('Auth error:', err);
		} finally {
			isLoading = false;
		}
	}

	async function handleVerification(event: Event) {
		event.preventDefault();
		isLoading = true;
		error = '';

		const formData = new FormData(event.currentTarget as HTMLFormElement);
		const code = formData.get('code') as string;

		try {
			const result = await signIn('password', {
				email: verificationStep?.email,
				code,
				flow: 'email-verification',
				redirectTo: '/product'
			});

			if (result.signingIn) {
				goto('/product');
			}
		} catch (err) {
			error = 'Invalid or expired verification code. Please try again.';
			console.error('Verification error:', err);
		} finally {
			isLoading = false;
		}
	}

	function cancelVerification() {
		verificationStep = null;
		error = '';
	}
</script>

<div class="flex min-h-screen w-full">
	<main class="mx-auto my-auto flex flex-col">
		<Card class="w-[400px]">
			<CardHeader>
				<CardTitle>{verificationStep ? 'Email Verification' : 'Welcome'}</CardTitle>
				<CardDescription>
					{verificationStep
						? 'Please check your email for a verification code'
						: 'Sign in to your account or create a new one'}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{#if verificationStep}
					<!-- Email Verification Step -->
					<form onsubmit={handleVerification} class="space-y-4">
						<p class="text-sm text-muted-foreground">
							We've sent an 8-digit verification code to <span class="font-medium"
								>{verificationStep.email}</span
							>
						</p>
						<div class="space-y-2">
							<Label for="verification-code">Verification Code</Label>
							<Input
								id="verification-code"
								type="text"
								name="code"
								placeholder="12345678"
								required
								disabled={isLoading}
								class="text-center text-2xl tracking-widest font-mono"
								autocomplete="one-time-code"
							/>
						</div>
						{#if error}
							<p class="text-sm text-red-500">{error}</p>
						{/if}
						<Button type="submit" class="w-full" disabled={isLoading}>
							{isLoading ? 'Verifying...' : 'Verify Email'}
						</Button>
						<Button type="button" variant="ghost" class="w-full" onclick={cancelVerification}>
							Cancel
						</Button>
					</form>
				{:else}
					<!-- Sign In / Sign Up Forms -->
					<Tabs bind:value={activeTab} class="w-full">
						<TabsList class="grid w-full grid-cols-2">
							<TabsTrigger value="signin">Sign In</TabsTrigger>
							<TabsTrigger value="signup">Sign Up</TabsTrigger>
						</TabsList>

						<TabsContent value="signin">
							<form onsubmit={(e) => handleEmailAuth(e, 'signIn')} class="space-y-4">
								<div class="space-y-2">
									<Label for="signin-email">Email</Label>
									<Input
										id="signin-email"
										type="email"
										name="email"
										placeholder="you@example.com"
										required
										disabled={isLoading}
									/>
								</div>
								<div class="space-y-2">
									<Label for="signin-password">Password</Label>
									<Input
										id="signin-password"
										type="password"
										name="password"
										placeholder="••••••••"
										required
										disabled={isLoading}
									/>
								</div>
								{#if error}
									<p class="text-sm text-red-500">{error}</p>
								{/if}
								<Button type="submit" class="w-full" disabled={isLoading}>
									{isLoading ? 'Signing in...' : 'Sign In'}
								</Button>
							</form>
						</TabsContent>

						<TabsContent value="signup">
							<form onsubmit={(e) => handleEmailAuth(e, 'signUp')} class="space-y-4">
								<div class="space-y-2">
									<Label for="signup-email">Email</Label>
									<Input
										id="signup-email"
										type="email"
										name="email"
										placeholder="you@example.com"
										required
										disabled={isLoading}
									/>
								</div>
								<div class="space-y-2">
									<Label for="signup-password">Password</Label>
									<Input
										id="signup-password"
										type="password"
										name="password"
										placeholder="••••••••"
										required
										minlength={8}
										disabled={isLoading}
									/>
								</div>
								{#if error}
									<p class="text-sm text-red-500">{error}</p>
								{/if}
								<Button type="submit" class="w-full" disabled={isLoading}>
									{isLoading ? 'Creating account...' : 'Sign Up'}
								</Button>
							</form>
						</TabsContent>
					</Tabs>
				{/if}

				{#if !verificationStep}
					<div class="relative my-6">
						<div class="absolute inset-0 flex items-center">
							<span class="w-full border-t"></span>
						</div>
						<div class="relative flex justify-center text-xs uppercase">
							<span class="bg-background px-2 text-muted-foreground">Or continue with</span>
						</div>
					</div>

					<div class="space-y-2">
						<Button
							onclick={() => signIn('github', { redirectTo: '/product' })}
							variant="outline"
							class="w-full"
						>
							<svg class="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
								<path
									d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
								/>
							</svg>
							GitHub
						</Button>
						<Button
							onclick={() => signIn('google', { redirectTo: '/product' })}
							variant="outline"
							class="w-full"
						>
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
							Google
						</Button>
					</div>
				{/if}

				{#if env.PUBLIC_E2E_TEST}
					<form
						class="mt-8 flex flex-col gap-2"
						onsubmit={(event) => {
							event.preventDefault();
							const formData = new FormData(event.currentTarget as HTMLFormElement);
							signIn('secret', formData)
								.then(() => {
									goto('/product');
								})
								.catch(() => {
									window.alert('Invalid secret');
								});
						}}
					>
						<p class="text-sm text-muted-foreground">Test only: Sign in with a secret</p>
						<Input aria-label="Secret" type="text" name="secret" placeholder="secret value" />
						<Button type="submit" variant="secondary">Sign in with secret</Button>
					</form>
				{/if}

				<div class="mt-6 text-center">
					<a class="text-sm text-muted-foreground hover:underline" href="/">Cancel</a>
				</div>
			</CardContent>
		</Card>
	</main>
</div>
