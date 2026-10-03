<script lang="ts">
	import { tick } from 'svelte';
	import { T, getTranslate } from '@tolgee/svelte';
	import { useConvexClient } from 'convex-svelte';
	import { authClient } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button';
	import * as Accordion from '$lib/components/ui/accordion';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Check from '@lucide/svelte/icons/check';
	import { getPasskeyDevice } from '$lib/utils/passkey-device';
	import { deferPasskeyNudge, type PasskeyNudgeUser } from '$lib/utils/passkey-nudge';
	import type { PendingOAuthProvider } from '$lib/hooks/last-auth-method.svelte.ts';

	let {
		user,
		provider,
		inline = false,
		oncontinue
	}: {
		user: PasskeyNudgeUser;
		provider?: PendingOAuthProvider;
		inline?: boolean;
		oncontinue: () => void;
	} = $props();

	const { t } = getTranslate();
	const client = useConvexClient();
	const session = authClient.useSession();
	$effect(() => {
		if ($session.data && $session.data.session.id !== user.sessionId) oncontinue();
	});
	let busy = $state(false);
	let complete = $state(false);
	let error = $state(false);
	let createdName = $state('');
	let heading: HTMLElement;
	const headingId = $props.id();

	function focusHeading(element: HTMLElement) {
		heading = element;
		if (!inline) element.focus({ preventScroll: true });
	}

	async function createPasskey() {
		if (busy) return;
		busy = true;
		error = false;
		try {
			const session = await authClient.getSession({
				fetchOptions: { signal: AbortSignal.timeout(5000) }
			});
			if (session.error || session.data?.session.id !== user.sessionId) {
				error = true;
				return;
			}
			const firstName = user.name.trim().split(/\s+/)[0] ?? '';
			const name = $t(
				`settings.security.passkey.${firstName ? 'suggested_name' : 'suggested_name_anonymous'}`,
				{
					name: firstName,
					device: $t(`settings.security.passkey.devices.${getPasskeyDevice(navigator)}`)
				}
			);
			const result = await authClient.passkey.addPasskey({ name });
			if (result.error || !result.data) {
				error = true;
				return;
			}
			createdName = name;
			complete = true;
			await tick();
			heading.focus({ preventScroll: true });
		} catch {
			error = true;
		} finally {
			busy = false;
		}
	}

	async function skip() {
		if (busy) return;
		busy = true;
		await deferPasskeyNudge(client, user.userId);
		oncontinue();
	}
</script>

<section
	aria-labelledby={headingId}
	class={inline ? 'flex flex-col gap-4' : 'flex flex-col gap-5 p-6 md:p-8'}
>
	{#if !inline && !complete}
		<p class="truncate text-sm text-muted-foreground">{user.email}</p>
	{/if}
	<div class={inline ? 'flex items-start gap-3' : 'flex flex-col gap-5'}>
		{#if complete}
			<Check
				class={inline ? 'size-6 shrink-0 text-success' : 'size-10 text-success'}
				aria-hidden="true"
			/>
		{:else}
			<KeyRound class={inline ? 'size-6 shrink-0' : 'size-10'} aria-hidden="true" />
		{/if}
		<svelte:element
			this={inline ? 'h2' : 'h1'}
			id={headingId}
			tabindex="-1"
			class={inline
				? 'text-lg font-semibold tracking-tight outline-none'
				: 'text-2xl font-semibold tracking-tight text-balance outline-none'}
			{@attach focusHeading}
		>
			<T
				keyName={complete
					? 'auth.passkey_nudge.success_title'
					: inline
						? 'auth.passkey_nudge.inline_title'
						: 'auth.passkey_nudge.title'}
			/>
		</svelte:element>
	</div>
	<p
		class={inline
			? 'text-sm text-pretty text-muted-foreground'
			: 'text-pretty text-muted-foreground'}
	>
		<T
			keyName={complete
				? 'auth.passkey_nudge.success_description'
				: 'auth.passkey_nudge.description'}
		/>
	</p>
	{#if complete}
		<p class="text-sm text-muted-foreground">{createdName}</p>
		<Button onclick={oncontinue}><T keyName="auth.passkey_nudge.continue" /></Button>
	{:else}
		<p class="text-sm text-muted-foreground">
			{#if provider}
				<T
					keyName="auth.passkey_nudge.provider_backup"
					params={{ provider: provider === 'google' ? 'Google' : 'GitHub' }}
				/>
			{:else}
				<T keyName="auth.passkey_nudge.password_backup" />
			{/if}
		</p>
		<div class={inline ? 'flex flex-wrap gap-2' : 'flex flex-col gap-2'}>
			<Button onclick={createPasskey} disabled={busy}>
				<T keyName={busy ? 'auth.passkey_nudge.working' : 'auth.passkey_nudge.create'} />
			</Button>
			<Button variant={inline ? 'ghost' : 'outline'} onclick={skip} disabled={busy}>
				<T keyName="auth.passkey_nudge.not_now" />
			</Button>
		</div>
		{#if !inline}
			<Accordion.Root type="single">
				<Accordion.Item value="about-passkeys">
					<Accordion.Trigger><T keyName="auth.passkey_nudge.about" /></Accordion.Trigger>
					<Accordion.Content
						><p class="text-muted-foreground">
							<T keyName="auth.passkey_nudge.about_description" />
						</p></Accordion.Content
					>
				</Accordion.Item>
			</Accordion.Root>
		{/if}
	{/if}
	<div role="status" class="text-sm text-muted-foreground" hidden={!error}>
		{#if error}<T keyName="auth.passkey_nudge.failed" />{/if}
	</div>
</section>
