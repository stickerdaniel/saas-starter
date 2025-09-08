<script lang="ts">
	import { api } from '$lib/convex/_generated/api';
	import Chat from '$lib/demo/Chat/Chat.svelte';
	import ChatIntro from '$lib/demo/Chat/ChatIntro.svelte';
	import { useQuery } from 'convex-svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import ChatSidebar from '$lib/components/chat-sidebar.svelte';
	import SiteHeader from '$lib/components/site-header.svelte';

	let { data } = $props();

	const viewer = useQuery(api.users.viewer, {}, () => ({ initialData: data.viewer }));
</script>

{#if viewer.data}
	<Sidebar.Provider
		style="--sidebar-width: calc(var(--spacing) * 72); --header-height: calc(var(--spacing) * 12);"
	>
		<ChatSidebar
			variant="inset"
			user={{
				name: viewer.data.name ?? 'User',
				email: viewer.data.email ?? '',
				image: viewer.data.image
			}}
		/>
		<Sidebar.Inset>
			<SiteHeader />
			<div class="flex flex-1 flex-col overflow-hidden">
				<div
					class="@container/main flex flex-1 gap-4 py-4 md:gap-6 md:py-6 px-4 lg:px-6 overflow-hidden"
				>
					<div class="flex-shrink-0">
						<ChatIntro />
					</div>
					<div class="flex-1 flex flex-col min-h-0">
						<Chat viewerId={viewer.data._id} initialMessages={data.messages} />
					</div>
				</div>
			</div>
		</Sidebar.Inset>
	</Sidebar.Provider>
{/if}
