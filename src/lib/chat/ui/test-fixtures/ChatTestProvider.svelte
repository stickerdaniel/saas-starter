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
	import {
		supportThreadContext,
		type SupportThreadContext
	} from '$lib/components/customer-support/support-thread-context.svelte.ts';

	let {
		client,
		content: Content,
		contentProps,
		supportThread,
		provideTolgee = true
	}: {
		client: ConvexClient;
		content: Component<Props>;
		contentProps: Props;
		supportThread?: SupportThreadContext;
		provideTolgee?: boolean;
	} = $props();

	// The provider is fixed for the mounted test instance.
	// svelte-ignore state_referenced_locally
	setConvexClientContext(client);
	adminSupportUIContext.set(new AdminSupportUIManager());
	// The optional support context is fixed for the mounted test instance.
	// svelte-ignore state_referenced_locally
	if (supportThread) supportThreadContext.set(supportThread);
	const tolgee = Tolgee().use(FormatSimple()).init({ language: 'en', staticData: { en } });
	// Tests may replace the child props without remounting its providers.
	// svelte-ignore state_referenced_locally
	let renderedContentProps = $state.raw(contentProps);

	export function setContentProps(next: Props) {
		renderedContentProps = next;
	}
</script>

{#if provideTolgee}
	<TolgeeProvider {tolgee}>
		<Content {...renderedContentProps} />
	</TolgeeProvider>
{:else}
	<Content {...renderedContentProps} />
{/if}
