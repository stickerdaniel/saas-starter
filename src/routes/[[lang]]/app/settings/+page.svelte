<script lang="ts">
	import type { PageData } from './$types';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { T, getTranslate } from '@tolgee/svelte';
	import { useSearchParams } from 'runed/kit';
	import * as v from 'valibot';
	import AccountSettings from './account-settings.svelte';
	import PasswordSettings from './password-settings.svelte';
	import EmailSettings from './email-settings.svelte';
	import SecuritySettings from './security-settings.svelte';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	let user = $derived(data.user);
	const { t } = getTranslate();
	const SETTINGS_TABS = ['account', 'password', 'email', 'security'] as const;
	type SettingsTab = (typeof SETTINGS_TABS)[number];
	const DEFAULT_SETTINGS_TAB: SettingsTab = 'account';
	const tabSchema = v.object({
		tab: v.optional(
			v.fallback(v.picklist(SETTINGS_TABS), DEFAULT_SETTINGS_TAB),
			DEFAULT_SETTINGS_TAB
		)
	});

	function isSettingsTab(value: string): value is SettingsTab {
		return SETTINGS_TABS.includes(value as SettingsTab);
	}

	const searchParams = useSearchParams(tabSchema, {
		showDefaults: true,
		pushHistory: true,
		noScroll: true
	});
	let activeTab = $derived(searchParams.tab);

	function updateTab(value: string) {
		if (!isSettingsTab(value) || value === searchParams.tab) return;
		searchParams.tab = value;
	}
</script>

<SEOHead title={$t('meta.app.settings.title')} description={$t('meta.app.settings.description')} />

<div class="flex flex-1 flex-col px-4 lg:px-6">
	<div class="mx-auto w-full max-w-3xl flex-1 space-y-6">
		<div>
			<h2 class="text-2xl font-bold tracking-tight">
				<T keyName="settings.title" />
			</h2>
			<p class="text-muted-foreground">
				<T keyName="settings.description" />
			</p>
		</div>

		<Separator />

		<Tabs.Root value={activeTab} onValueChange={updateTab} class="space-y-6">
			<Tabs.List>
				<Tabs.Trigger value="account">
					<T keyName="settings.tabs.account" />
				</Tabs.Trigger>
				<Tabs.Trigger value="password">
					<T keyName="settings.tabs.password" />
				</Tabs.Trigger>
				<Tabs.Trigger value="email">
					<T keyName="settings.tabs.email" />
				</Tabs.Trigger>
				<Tabs.Trigger value="security">
					<T keyName="settings.tabs.security" />
				</Tabs.Trigger>
			</Tabs.List>

			<Tabs.Content value="account" class="space-y-6">
				{#if user}
					<AccountSettings {user} />
				{/if}
			</Tabs.Content>

			<Tabs.Content value="password" class="space-y-6">
				<PasswordSettings />
			</Tabs.Content>

			<Tabs.Content value="email" class="space-y-6">
				{#if user}
					<EmailSettings {user} />
				{/if}
			</Tabs.Content>

			<Tabs.Content value="security" class="space-y-6">
				<SecuritySettings />
			</Tabs.Content>
		</Tabs.Root>
	</div>
</div>
