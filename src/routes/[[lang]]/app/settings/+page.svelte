<script lang="ts">
	import type { PageData } from './$types';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { T } from '@tolgee/svelte';
	import AccountSettings from './account-settings.svelte';
	import PasswordSettings from './password-settings.svelte';
	import EmailSettings from './email-settings.svelte';
	import SecuritySettings from './security-settings.svelte';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	let user = $derived(data.user);
</script>

<svelte:head>
	<title>Settings</title>
</svelte:head>

<div class="flex flex-1 flex-col px-4 lg:px-6">
	<div class="flex-1 space-y-6">
		<div>
			<h2 class="text-2xl font-bold tracking-tight">
				<T keyName="settings.title" />
			</h2>
			<p class="text-muted-foreground">
				<T keyName="settings.description" />
			</p>
		</div>

		<Separator />

		<Tabs.Root value="account" class="space-y-6">
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
