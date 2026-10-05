<script lang="ts">
	import type { ComponentProps, Snippet } from 'svelte';
	import { api } from '$lib/convex/_generated/api';
	import ChatRoot from '../ChatRoot.svelte';
	import ChatInput from '../ChatInput.svelte';
	import type { ChatUIContext } from '../chat-context.svelte.ts';

	type InputProps = Omit<
		ComponentProps<typeof ChatInput>,
		'actionsLeft' | 'actionsRight' | 'notice'
	>;

	let {
		context,
		actions = 'default',
		withNotice = false,
		...inputProps
	}: {
		context: ChatUIContext;
		/** How the caller fills the action slots: not at all, replacing, or wrapping the defaults. */
		actions?: 'default' | 'replace' | 'wrap';
		/** Whether the caller shows feedback of its own through the notice. */
		withNotice?: boolean;
	} & InputProps = $props();
</script>

{#snippet callerNotice()}
	<p data-testid="caller-notice"></p>
{/snippet}

{#snippet replaceLeft()}
	<span data-testid="custom-left"></span>
{/snippet}

{#snippet replaceRight()}
	<span data-testid="custom-right"></span>
{/snippet}

{#snippet wrapLeft(defaults: Snippet)}
	<span data-testid="custom-left"></span>
	{@render defaults()}
{/snippet}

{#snippet wrapRight(defaults: Snippet)}
	{@render defaults()}
	<span data-testid="custom-right"></span>
{/snippet}

<ChatRoot
	threadId={context.core.threadId}
	externalCore={context.core}
	externalUIContext={context}
	api={{ listMessages: api.aiChat.messages.listMessages }}
>
	<ChatInput
		{...inputProps}
		notice={withNotice ? callerNotice : undefined}
		actionsLeft={actions === 'replace' ? replaceLeft : actions === 'wrap' ? wrapLeft : undefined}
		actionsRight={actions === 'replace' ? replaceRight : actions === 'wrap' ? wrapRight : undefined}
	/>
</ChatRoot>
<!-- An unrelated drop target next to the composer, as a page may host one. -->
<div data-testid="adjacent-drop-target"></div>
