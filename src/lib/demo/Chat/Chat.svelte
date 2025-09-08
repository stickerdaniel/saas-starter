<script lang="ts">
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import type { Id } from '$lib/convex/_generated/dataModel';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Chat from '$lib/components/ui/chat/index.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import VideoIcon from '@lucide/svelte/icons/video';
	import InfoIcon from '@lucide/svelte/icons/info';
	import SendIcon from '@lucide/svelte/icons/send';
	import InnerShadowTopIcon from '@tabler/icons-svelte/icons/inner-shadow-top';

	interface Props {
		viewerId: Id<'users'>;
		initialMessages?: {
			author: string;
			authorImage: string | undefined;
			_id: Id<'messages'>;
			_creationTime: number;
			userId: Id<'users'>;
			body: string;
		}[];
	}

	let { viewerId, initialMessages }: Props = $props();

	const client = useConvexClient();
	const viewer = useQuery(api.users.viewer, {});

	let newMessageText = $state('');

	const messages = useQuery(api.messages.list, {}, () => ({ initialData: initialMessages }));

	async function handleSubmit(event: Event) {
		event.preventDefault();
		if (newMessageText.trim() === '') return;

		try {
			await client.mutation(api.messages.send, { body: newMessageText });
			newMessageText = '';
		} catch (error) {
			console.error('Failed to send message:', error);
		}
	}

	function formatTime(timestamp: number) {
		return new Date(timestamp).toLocaleTimeString('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			hour12: true
		});
	}

	function getInitials(name: string) {
		return name
			.split(' ')
			.map((n) => n[0])
			.join('')
			.toUpperCase();
	}
</script>

<div class="w-full border border-border">
	<div class="flex place-items-center justify-between border-b bg-background p-2">
		<div class="flex place-items-center gap-2">
			<div class="flex size-8 items-center justify-center">
				<InnerShadowTopIcon class="!size-5" />
			</div>
			<div class="flex flex-col">
				<span class="text-sm font-medium">Chat</span>
				<span class="text-xs">Real-time chat</span>
			</div>
		</div>
		<div class="flex place-items-center">
			<Button variant="ghost" size="icon" class="rounded-full">
				<PhoneIcon />
			</Button>
			<Button variant="ghost" size="icon" class="rounded-full">
				<VideoIcon />
			</Button>
			<Button variant="ghost" size="icon" class="rounded-full">
				<InfoIcon />
			</Button>
		</div>
	</div>
	<Chat.List class="max-h-[calc(100vh-15rem)]">
		{#if messages.data}
			{#each messages.data as message}
				<Chat.Bubble variant={message.userId === viewerId ? 'sent' : 'received'}>
					<Chat.BubbleAvatar>
						<Chat.BubbleAvatarImage
							src={message.userId === viewerId ? viewer.data?.image : message.authorImage}
							alt={message.author}
						/>
						<Chat.BubbleAvatarFallback>
							{getInitials(message.author)}
						</Chat.BubbleAvatarFallback>
					</Chat.BubbleAvatar>
					<Chat.BubbleMessage class="flex flex-col gap-1">
						<p>{message.body}</p>
						<div class="w-full text-xs group-data-[variant='sent']/chat-bubble:text-end">
							{formatTime(message._creationTime)}
						</div>
					</Chat.BubbleMessage>
				</Chat.Bubble>
			{/each}
		{/if}
	</Chat.List>
	<form onsubmit={handleSubmit} class="flex place-items-center gap-2 p-2">
		<Input bind:value={newMessageText} class="rounded-full" placeholder="Type a message..." />
		<Button
			type="submit"
			variant="default"
			size="icon"
			class="shrink-0 rounded-full"
			disabled={newMessageText === ''}
		>
			<SendIcon />
		</Button>
	</form>
</div>
