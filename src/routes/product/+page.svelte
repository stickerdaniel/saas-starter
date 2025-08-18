<script lang="ts">
	import { api } from '$lib/convex/_generated/api';
	import Chat from '$lib/demo/Chat/Chat.svelte';
	import ChatIntro from '$lib/demo/Chat/ChatIntro.svelte';
	import UserMenu from '$lib/demo/UserMenu.svelte';
	import { useQuery } from 'convex-svelte';

	let { data } = $props();

	const viewer = useQuery(api.users.viewer, {}, () => ({ initialData: data.viewer }));
</script>

{#if viewer.data}
	<main class="flex max-h-screen grow flex-col overflow-hidden">
		<div class="border-surface-200-800 flex items-start justify-between border-b p-4">
			<ChatIntro />
			<UserMenu viewer={viewer.data} />
		</div>
		<Chat viewerId={viewer.data._id} initialMessages={data.messages} />
	</main>
{/if}
