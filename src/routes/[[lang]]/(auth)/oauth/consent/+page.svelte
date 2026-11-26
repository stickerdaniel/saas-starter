<script lang="ts">
	import { onMount } from 'svelte';
	import { T, getTranslate } from '@tolgee/svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import SEOHead from '#lib/components/SEOHead.svelte';
	import AuthPanel from '#lib/components/auth/auth-panel.svelte';
	import Logo from '#lib/components/icons/logo.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { oauthAuthClient } from '#lib/auth-client-oauth.js';
	import { capabilitiesAt, capabilityKey, type CapabilityLevel } from '#lib/mcp/capabilities.js';
	import { localizedHref } from '#lib/utils/i18n.js';
	import AuthGate from '../../AuthGate.svelte';

	let { data } = $props();

	const { t } = getTranslate();
	const id = $props.id();

	const requested = $derived(
		(page.url.searchParams.get('scope') ?? '').split(' ').filter((scope) => scope !== '')
	);
	const canView = $derived(requested.includes('mcp:read'));
	const offersChoice = $derived(canView && requested.includes('mcp:write'));
	const app = $derived(data.client?.name || $t('mcp.consent.unnamed_app'));

	const capabilities = [...capabilitiesAt('view'), ...capabilitiesAt('change')];
	const levelKey = {
		view: 'mcp.consent.level.view',
		change: 'mcp.consent.level.change'
	} as const satisfies Record<CapabilityLevel, string>;

	let change = $state(true);
	let pending = $state(false);
	let failed = $state(false);
	let hydrated = $state(false);
	const disabled = $derived(pending || !hydrated);

	onMount(() => {
		hydrated = true;
	});

	const narrowedScope = $derived(
		offersChoice && !change
			? requested.filter((scope) => scope !== 'mcp:write').join(' ')
			: undefined
	);

	async function respond(accept: boolean) {
		pending = true;
		const scope = accept ? narrowedScope : undefined;
		const result = await oauthAuthClient.oauth2
			.consent({ accept, ...(scope === undefined ? {} : { scope }) })
			.catch(() => null);
		if (result?.error === null) return;
		failed = true;
		pending = false;
	}

	function allow(event: SubmitEvent) {
		event.preventDefault();
		void respond(true);
	}
</script>

<SEOHead
	title={$t('meta.auth.consent.title')}
	description={$t('meta.auth.consent.description')}
	noindex
/>

<AuthPanel>
	<AuthGate>
		<form class="flex min-h-96 flex-col" onsubmit={allow} novalidate>
			<div class="h-1"></div>
			<div class="flex flex-1 flex-col justify-center p-6 md:p-8">
				<Logo class="mb-6 size-6 text-foreground" />
				{#if data.client === null || failed}
					<div class="flex flex-col gap-2" role={failed ? 'alert' : undefined}>
						<h1 class="text-2xl font-bold"><T keyName="mcp.consent.error_title" /></h1>
						<p class="text-balance text-muted-foreground">
							<T keyName="mcp.consent.error_description" />
						</p>
					</div>
				{:else}
					<div class="flex flex-col gap-8">
						<div class="flex flex-col gap-2">
							<h1 class="text-2xl font-bold wrap-anywhere">{$t('mcp.consent.title', { app })}</h1>
							{#if data.viewer?.email}
								<p class="text-balance text-muted-foreground">
									{$t('mcp.consent.signed_in_as', { email: data.viewer.email })}
								</p>
							{/if}
						</div>
						{#if canView}
							<div class="flex flex-col gap-4">
								<p id="{id}-permissions" class="font-medium">
									<T keyName="mcp.consent.permissions" />
								</p>
								<ul aria-labelledby="{id}-permissions" class="divide-y rounded-md border">
									{#each capabilities as capability (capability.tool)}
										{@const sentence = $t(capabilityKey(capability))}
										{@const optional = capability.level === 'change'}
										{@const granted = !optional || (offersChoice && change)}
										<li class="flex items-start gap-3 p-3 text-sm leading-snug">
											{#if optional && offersChoice}
												<Checkbox
													id="{id}-{capability.tool}"
													bind:checked={change}
													{disabled}
													class="mt-px"
												/>
											{:else}
												<Checkbox
													id="{id}-{capability.tool}"
													checked={granted}
													disabled
													aria-label={$t(
														optional ? 'mcp.consent.not_requested' : 'mcp.consent.always_included',
														{ capability: sentence }
													)}
													class="mt-px"
												/>
											{/if}
											<label
												for="{id}-{capability.tool}"
												class={['flex-1', !granted && 'text-muted-foreground']}
											>
												{sentence}
											</label>
											<span class="shrink-0 text-xs font-medium text-muted-foreground">
												<T keyName={levelKey[capability.level]} />
											</span>
										</li>
									{/each}
								</ul>
							</div>
						{:else}
							<p class="text-sm font-medium">{$t('mcp.consent.no_access', { app })}</p>
						{/if}
						<div class="flex flex-wrap-reverse gap-2">
							<Button
								type="button"
								variant="outline"
								class="flex-1"
								{disabled}
								onclick={() => respond(false)}
							>
								<T keyName="mcp.consent.deny" />
							</Button>
							<Button type="submit" class="flex-1" {disabled}>
								<T keyName="mcp.consent.allow" />
							</Button>
						</div>
					</div>
				{/if}
			</div>
		</form>
	</AuthGate>
	{#snippet footer()}
		<T keyName="mcp.consent.footer_before" />
		<a href={resolve(localizedHref('/app/settings?tab=apps'))} class="underline underline-offset-4"
			><T keyName="mcp.consent.footer_link" /></a
		>
		<T keyName="mcp.consent.footer_after" />
	{/snippet}
</AuthPanel>
