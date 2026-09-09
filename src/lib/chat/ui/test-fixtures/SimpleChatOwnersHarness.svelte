<script module lang="ts">
	export const simpleChatOwnersHarness: {
		setFirstThreadId?: (threadId: string) => void;
		setSecondThreadId?: (threadId: string) => void;
		hideFirst?: () => void;
		hideSecond?: () => void;
	} = {};
</script>

<script lang="ts">
	import { onDestroy } from 'svelte';
	import SimpleChat from '../../examples/SimpleChat.svelte';

	let {
		firstThreadId,
		secondThreadId
	}: {
		firstThreadId: string;
		secondThreadId: string;
	} = $props();

	let firstVisible = $state(true);
	let secondVisible = $state(true);
	// Harness setters own later updates after these initial prop values.
	// svelte-ignore state_referenced_locally
	let currentFirstThreadId = $state(firstThreadId);
	// svelte-ignore state_referenced_locally
	let currentSecondThreadId = $state(secondThreadId);

	simpleChatOwnersHarness.setFirstThreadId = (threadId) => {
		currentFirstThreadId = threadId;
	};
	simpleChatOwnersHarness.setSecondThreadId = (threadId) => {
		currentSecondThreadId = threadId;
	};
	simpleChatOwnersHarness.hideFirst = () => {
		firstVisible = false;
	};
	simpleChatOwnersHarness.hideSecond = () => {
		secondVisible = false;
	};

	onDestroy(() => {
		delete simpleChatOwnersHarness.setFirstThreadId;
		delete simpleChatOwnersHarness.setSecondThreadId;
		delete simpleChatOwnersHarness.hideFirst;
		delete simpleChatOwnersHarness.hideSecond;
	});
</script>

<div data-simple-chat-owner="first">
	{#if firstVisible}
		<SimpleChat threadId={currentFirstThreadId} />
	{/if}
</div>
<div data-simple-chat-owner="second">
	{#if secondVisible}
		<SimpleChat threadId={currentSecondThreadId} />
	{/if}
</div>
