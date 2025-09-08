<script lang="ts">
	import { api } from '$lib/convex/_generated/api';
	import Chat from '$lib/components/Chat/Chat.svelte';
	import ChatIntro from '$lib/components/Chat/ChatIntro.svelte';
	import { useQuery } from 'convex-svelte';

	let { data } = $props();

	const viewer = useQuery(api.users.viewer, {}, () => ({ initialData: data.viewer }));
</script>

{#if viewer.data}
	<div
		class="@container/main flex flex-1 flex-col gap-4 overflow-hidden px-4 py-4 md:gap-6 md:py-6 lg:flex-row lg:px-6"
	>
		<div class="flex-shrink-0">
			<ChatIntro />
		</div>
		<div class="flex min-h-0 flex-1 flex-col">
			<Chat viewerId={viewer.data._id} initialMessages={data.messages} />
		</div>
	</div>
{/if}
