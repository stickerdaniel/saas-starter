<script lang="ts" generics="Props extends Record<string, unknown>">
	import type { Component } from 'svelte';
	import type { ConvexClient } from 'convex/browser';
	import { setConvexClientContext } from 'convex-svelte';
	import { FormatSimple, Tolgee, TolgeeProvider } from '@tolgee/svelte';
	import en from '../../../../i18n/en.json';
	import {
		AdminSupportUIManager,
		adminSupportUIContext
	} from '$lib/hooks/admin-support-ui.svelte.ts';

	let {
		client,
		content: Content,
		contentProps
	}: {
		client: ConvexClient;
		content: Component<Props>;
		contentProps: Props;
	} = $props();

	// The provider is fixed for the mounted test instance.
	// svelte-ignore state_referenced_locally
	setConvexClientContext(client);
	adminSupportUIContext.set(new AdminSupportUIManager());
	const tolgee = Tolgee().use(FormatSimple()).init({ language: 'en', staticData: { en } });
</script>

<TolgeeProvider {tolgee}>
	<Content {...contentProps} />
</TolgeeProvider>
