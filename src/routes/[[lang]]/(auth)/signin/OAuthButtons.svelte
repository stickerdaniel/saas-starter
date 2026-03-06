<script lang="ts">
	import { T } from '@tolgee/svelte';
	import KeyIcon from '@lucide/svelte/icons/key-round';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { LastAuthMethod, PendingOAuthProvider } from '$lib/hooks/last-auth-method.svelte';

	type OAuthProviderAvailability = {
		google?: boolean;
		github?: boolean;
	};

	type Props = {
		mode: 'signin' | 'signup';
		providers: OAuthProviderAvailability | undefined;
		isLoading: boolean;
		showPasskey: boolean;
		enabledProviderCount: number;
		isLastUsedAuthMethod: (method: LastAuthMethod) => boolean;
		onOAuth: (provider: PendingOAuthProvider) => void;
		onPasskey?: () => void;
	};

	let {
		mode,
		providers,
		isLoading,
		showPasskey,
		enabledProviderCount,
		isLastUsedAuthMethod,
		onOAuth,
		onPasskey
	}: Props = $props();
</script>

<div
	class="grid gap-4"
	style="grid-template-columns: repeat({enabledProviderCount}, minmax(0, 1fr));"
>
	{#if providers?.google}
		<div class="relative">
			<Button
				class="w-full"
				data-testid="{mode}-oauth-google-button"
				variant="outline"
				type="button"
				onclick={() => onOAuth('google')}
				disabled={isLoading}
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
					<path
						d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
						fill="currentColor"
					/>
				</svg>
				<span class="sr-only"><T keyName="auth.signin.oauth_google" /></span>
			</Button>
			{#if isLastUsedAuthMethod('google')}
				<Badge
					variant="secondary"
					class="pointer-events-none absolute -top-2 -right-2 px-1.5 py-0 text-[10px] whitespace-nowrap"
					data-testid="oauth-google-last-used-badge"
				>
					<T keyName="auth.signin.oauth_last_used" defaultValue="Last used" />
				</Badge>
			{/if}
		</div>
	{/if}
	{#if providers?.github}
		<div class="relative">
			<Button
				class="w-full"
				data-testid="{mode}-oauth-github-button"
				variant="outline"
				type="button"
				onclick={() => onOAuth('github')}
				disabled={isLoading}
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
					<path
						d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
						fill="currentColor"
					/>
				</svg>
				<span class="sr-only"><T keyName="auth.signin.oauth_github" /></span>
			</Button>
			{#if isLastUsedAuthMethod('github')}
				<Badge
					variant="secondary"
					class="pointer-events-none absolute -top-2 -right-2 px-1.5 py-0 text-[10px] whitespace-nowrap"
					data-testid="oauth-github-last-used-badge"
				>
					<T keyName="auth.signin.oauth_last_used" defaultValue="Last used" />
				</Badge>
			{/if}
		</div>
	{/if}
	{#if showPasskey}
		<div class="relative">
			<Button
				class="w-full"
				data-testid="{mode}-oauth-passkey-button"
				variant="outline"
				type="button"
				onclick={onPasskey}
				disabled={isLoading}
			>
				<KeyIcon class="h-4 w-4" />
				<span class="sr-only"
					><T keyName="auth.signin.passkey_button" defaultValue="Sign in with Passkey" /></span
				>
			</Button>
			{#if isLastUsedAuthMethod('passkey')}
				<Badge
					variant="secondary"
					class="pointer-events-none absolute -top-2 -right-2 px-1.5 py-0 text-[10px] whitespace-nowrap"
					data-testid="oauth-passkey-last-used-badge"
				>
					<T keyName="auth.signin.oauth_last_used" defaultValue="Last used" />
				</Badge>
			{/if}
		</div>
	{/if}
</div>
