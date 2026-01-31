<script lang="ts">
	import { api } from '$lib/convex/_generated/api';
	import AppPageTitle from '$lib/components/app/app-page-title.svelte';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { useCustomer, useAutumnOperation } from '@stickerdaniel/convex-autumn-svelte/sveltekit';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Chat from '$lib/components/ui/chat/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import VideoIcon from '@lucide/svelte/icons/video';
	import InfoIcon from '@lucide/svelte/icons/info';
	import SendIcon from '@lucide/svelte/icons/send';
	import InnerShadowTopIcon from '@tabler/icons-svelte/icons/inner-shadow-top';
	import { toast } from 'svelte-sonner';

	import { page } from '$app/state';
	import { T, getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

	let { data } = $props();

	const client = useConvexClient();
	const viewer = useQuery(api.users.viewer, {}, () => ({ initialData: data.viewer }));
	const messages = useQuery(api.messages.list, {}, () => ({ initialData: data.messages }));

	// Get Autumn customer data for billing info
	// Access through the object to preserve getter reactivity
	const autumn = useCustomer();
	const upgradeOperation = useAutumnOperation(autumn.checkout);

	let newMessageText = $state('');
	let sendError = $state<string | null>(null);

	// Check if user has Pro subscription
	const isPro = $derived(autumn.customer?.products?.some((p) => p.id === 'pro') ?? false);

	// Get feature data directly from customer for usage tracking
	const messagesFeature = $derived(autumn.customer?.features?.messages);
	const hasMessagesAvailable = $derived(isPro || (messagesFeature?.balance ?? 0) > 0);
	const remainingMessages = $derived(messagesFeature?.balance ?? 0);
	// Handle included_usage which can be number, "inf", or undefined
	const totalMessages = $derived(
		messagesFeature?.included_usage === 'inf'
			? Infinity
			: typeof messagesFeature?.included_usage === 'number'
				? messagesFeature.included_usage
				: 0
	);
	const _usedMessages = $derived(totalMessages - remainingMessages);

	async function handleSubmit(event: Event) {
		event.preventDefault();
		if (newMessageText.trim() === '') return;

		sendError = null;

		try {
			const result = await client.action(api.messages.send, { body: newMessageText });

			if (!result.success) {
				sendError = result.error ?? $t('chat.messages.send_failed');
				toast.error(sendError);
				return;
			}

			newMessageText = '';
			await autumn.refetch();
			toast.success($t('chat.messages.sent_success'));
		} catch (error) {
			console.error('Failed to send message:', error);
			sendError = $t('chat.messages.send_failed');
			toast.error(sendError);
		}
	}

	async function handleUpgrade() {
		const result = await upgradeOperation.execute({
			productId: 'pro',
			successUrl: page.url.href + '?upgraded=true'
		});

		if (result?.url) {
			window.location.href = result.url;
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

{#if viewer.data}
	<div class="h-full px-4 lg:px-6">
		<div class="flex flex-1 flex-wrap gap-4 md:gap-6">
			<AppPageTitle title={$t('chat.title')} description={$t('chat.description')} />

			<!-- Quota warning banner -->
			{#if !isPro && !hasMessagesAvailable}
				<Alert.Root variant="destructive" class="w-full">
					<Alert.Title><T keyName="chat.alerts.limit_reached.title" /></Alert.Title>
					<Alert.Description class="flex items-center justify-between">
						<span>
							<T
								keyName="chat.alerts.limit_reached.description"
								params={{ total: totalMessages }}
							/>
						</span>
						<Button
							size="sm"
							variant="outline"
							onclick={handleUpgrade}
							disabled={upgradeOperation.isLoading}
						>
							{upgradeOperation.isLoading
								? $t('chat.buttons.processing')
								: $t('chat.buttons.upgrade')}
						</Button>
					</Alert.Description>
				</Alert.Root>
			{:else if !isPro && remainingMessages <= 3}
				<Alert.Root class="w-full">
					<Alert.Title><T keyName="chat.alerts.low_messages.title" /></Alert.Title>
					<Alert.Description class="flex items-center justify-between">
						<span>
							<T
								keyName={remainingMessages !== 1
									? 'chat.alerts.low_messages.description_plural'
									: 'chat.alerts.low_messages.description'}
								params={{ remaining: remainingMessages, total: totalMessages }}
							/>
						</span>
						<Button
							size="sm"
							variant="outline"
							onclick={handleUpgrade}
							disabled={upgradeOperation.isLoading}
						>
							{upgradeOperation.isLoading
								? $t('chat.buttons.processing')
								: $t('chat.buttons.upgrade')}
						</Button>
					</Alert.Description>
				</Alert.Root>
			{/if}

			<div class="flex-1 rounded-lg border">
				<div class="flex place-items-center justify-between border-b p-2">
					<div class="flex place-items-center gap-2">
						<div class="flex size-8 items-center justify-center">
							<InnerShadowTopIcon class="!size-5" />
						</div>
						<div class="flex flex-col">
							<span class="text-sm font-medium">
								<T keyName="chat.header.title" />
								{#if isPro}
									<span class="ml-2 text-xs font-normal text-muted-foreground">
										<T keyName="chat.header.pro_unlimited" />
									</span>
								{:else}
									<span class="ml-2 text-xs font-normal text-muted-foreground">
										<T
											keyName={remainingMessages !== 1
												? 'chat.header.messages_left_plural'
												: 'chat.header.messages_left'}
											params={{ remaining: remainingMessages, total: totalMessages }}
										/>
									</span>
								{/if}
							</span>
							<span class="text-xs text-nowrap">
								<T keyName="chat.header.subtitle" />
							</span>
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
				<Chat.List class="!h-[calc(100dvh-var(--header-height)-12rem)]">
					{#if messages.data}
						{#each messages.data as message (message._id)}
							<Chat.Bubble variant={message.userId === viewer.data._id ? 'sent' : 'received'}>
								<Chat.BubbleAvatar>
									<Chat.BubbleAvatarImage
										src={message.userId === viewer.data._id
											? viewer.data?.image
											: message.authorImage}
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
					<Input
						bind:value={newMessageText}
						class="rounded-full"
						placeholder={hasMessagesAvailable
							? $t('chat.input.placeholder')
							: $t('chat.input.placeholder_disabled')}
						disabled={!hasMessagesAvailable}
					/>
					<Button
						type="submit"
						variant="default"
						size="icon"
						class="shrink-0 rounded-full"
						disabled={newMessageText === '' || !hasMessagesAvailable}
						title={!hasMessagesAvailable
							? $t('chat.input.upgrade_tooltip')
							: $t('chat.input.send_tooltip')}
					>
						<SendIcon />
					</Button>
				</form>
			</div>
		</div>
	</div>
{/if}
