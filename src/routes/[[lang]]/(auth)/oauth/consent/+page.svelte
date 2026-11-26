<script lang="ts">
	import { onMount } from 'svelte';
	import { T, getTranslate } from '@tolgee/svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import SEOHead from '#lib/components/SEOHead.svelte';
	import AuthPanel from '#lib/components/auth/auth-panel.svelte';
	import Logo from '#lib/components/icons/logo.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as RadioGroup from '#lib/components/ui/radio-group/index.js';
	import { oauthAuthClient } from '#lib/auth-client-oauth.js';
	import { capabilitiesAt, type CapabilityLevel } from '#lib/mcp/capabilities.js';
	import { localizedHref } from '#lib/utils/i18n.js';
	import AuthGate from '../../AuthGate.svelte';
	import CapabilityList from './capability-list.svelte';

	let { data } = $props();

	const { t } = getTranslate();
	const id = $props.id();

	const requested = $derived(
		(page.url.searchParams.get('scope') ?? '').split(' ').filter((scope) => scope !== '')
	);
	const canView = $derived(requested.includes('mcp:read'));
	const offersChoice = $derived(canView && requested.includes('mcp:write'));
	const app = $derived(data.client?.name || $t('mcp.consent.unnamed_app'));

	let level = $state<CapabilityLevel>('change');
	let pending = $state(false);
	let failed = $state(false);
	let hydrated = $state(false);
	const disabled = $derived(pending || !hydrated);

	onMount(() => {
		hydrated = true;
	});

	const narrowedScope = $derived(
		offersChoice && level === 'view'
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
					<Field.Group>
						<div class="flex flex-col gap-2">
							<h1 class="text-2xl font-bold">{$t('mcp.consent.title', { app })}</h1>
							{#if data.viewer?.email}
								<p class="text-balance text-muted-foreground">
									{$t('mcp.consent.signed_in_as', { email: data.viewer.email })}
								</p>
							{/if}
						</div>
						{#if canView}
							<div class="flex flex-col gap-3">
								<p id="{id}-view" class="text-sm font-medium">
									{$t('mcp.consent.can_view', { app })}
								</p>
								<CapabilityList capabilities={capabilitiesAt('view')} labelledby="{id}-view" />
							</div>
							{#if offersChoice}
								<Field.Set class="gap-0">
									<Field.Legend variant="label">
										{$t('mcp.consent.change_question', { app })}
									</Field.Legend>
									<RadioGroup.Root bind:value={level} {disabled}>
										<Field.Label for="{id}-level-view">
											<Field.Field orientation="horizontal">
												<RadioGroup.Item value="view" id="{id}-level-view" />
												<Field.Content>
													<Field.Title><T keyName="mcp.consent.view_only" /></Field.Title>
													<Field.Description>
														{$t('mcp.consent.view_only_description', { app })}
													</Field.Description>
												</Field.Content>
											</Field.Field>
										</Field.Label>
										<Field.Label for="{id}-level-change">
											<Field.Field orientation="horizontal">
												<RadioGroup.Item value="change" id="{id}-level-change" />
												<Field.Content class="gap-2.5">
													<Field.Title id="{id}-change">
														<T keyName="mcp.consent.view_and_change" />
													</Field.Title>
													<CapabilityList
														capabilities={capabilitiesAt('change')}
														labelledby="{id}-change"
													/>
												</Field.Content>
											</Field.Field>
										</Field.Label>
									</RadioGroup.Root>
								</Field.Set>
							{:else}
								<div class="flex flex-col gap-3">
									<p id="{id}-denied" class="text-sm font-medium">
										{$t('mcp.consent.cannot_change', { app })}
									</p>
									<CapabilityList
										capabilities={capabilitiesAt('change')}
										labelledby="{id}-denied"
									/>
								</div>
							{/if}
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
					</Field.Group>
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
