<script lang="ts">
	import { useConvexClient } from 'convex-svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/convex/_generated/api';
	import ChatRoot from '$lib/chat/ui/ChatRoot.svelte';
	import ChatMessages from '$lib/chat/ui/ChatMessages.svelte';
	import ChatInput from '$lib/chat/ui/ChatInput.svelte';
	import { ChatUIContext, type UploadConfig } from '$lib/chat/ui/ChatContext.svelte';
	import { ChatCore } from '$lib/chat/core/ChatCore.svelte';
	import { Button } from '$lib/components/ui/button';
	import LockIcon from '@lucide/svelte/icons/lock';
	import { T, getTranslate } from '@tolgee/svelte';
	import { page } from '$app/state';
	import { tick } from 'svelte';

	const { t } = getTranslate();

	let {
		threadId,
		isPro = false,
		onUpgrade,
		isUpgrading = false,
		onMessageSent
	}: {
		threadId: string;
		isPro?: boolean;
		onUpgrade?: () => void;
		isUpgrading?: boolean;
		onMessageSent?: () => void;
	} = $props();

	const client = useConvexClient();

	const uploadConfig: UploadConfig = {
		generateUploadUrl: api.aiChat.files.generateUploadUrl,
		saveUploadedFile: api.aiChat.files.saveUploadedFile,
		locale: page.data.lang,
		getAccessKey: () => threadId || 'ai-chat'
	};

	// Create ChatCore for this thread
	// svelte-ignore state_referenced_locally
	const chatCore = new ChatCore({
		threadId: threadId || null,
		api: {
			sendMessage: api.aiChat.messages.sendMessage,
			listMessages: api.aiChat.messages.listMessages
		}
	});

	$effect(() => {
		const newId = threadId || null;
		if (chatCore.threadId !== newId) {
			// When transitioning from null to a real threadId (initial creation),
			// just update the ID without resetting state to avoid re-animating suggestions
			if (chatCore.threadId === null && newId !== null) {
				chatCore.threadId = newId;
			} else {
				chatCore.setThread(newId);
			}
		}
	});

	const chatUIContext = new ChatUIContext(chatCore, client, uploadConfig, 'right');

	// Auto-focus input when thread changes
	let chatContainer: HTMLDivElement | undefined = $state();

	$effect(() => {
		void threadId;
		if (!chatContainer) return;
		tick().then(() => {
			chatContainer?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
		});
	});

	const suggestions = [
		{ text: $t('ai_chat.suggestion.understand'), label: $t('ai_chat.suggestion.understand') },
		{ text: $t('ai_chat.suggestion.explain'), label: $t('ai_chat.suggestion.explain') },
		{ text: $t('ai_chat.suggestion.help'), label: $t('ai_chat.suggestion.help') }
	];
</script>

<div bind:this={chatContainer} class="flex h-full flex-col">
	<ChatRoot
		threadId={threadId || null}
		externalCore={chatCore}
		externalUIContext={chatUIContext}
		api={{
			listMessages: api.aiChat.messages.listMessages,
			sendMessage: api.aiChat.messages.sendMessage
		}}
	>
		<div class="flex-1 overflow-hidden">
			<ChatMessages />
		</div>

		<div class="relative z-20 mx-auto w-full max-w-3xl -translate-y-4">
			{#if !isPro}
				<!-- Pro upgrade banner floating above input -->
				<div
					class="mx-4 mb-2 flex items-center justify-between rounded-lg border border-border/50 bg-muted/50 px-4 py-3 backdrop-blur-sm"
				>
					<div class="flex items-center gap-2 text-sm text-muted-foreground">
						<LockIcon class="size-4 shrink-0" />
						<span><T keyName="ai_chat.pro_required.description" /></span>
					</div>
					<Button size="sm" variant="default" onclick={onUpgrade} disabled={isUpgrading}>
						{isUpgrading ? $t('chat.buttons.processing') : $t('chat.buttons.upgrade')}
					</Button>
				</div>
			{/if}
			<ChatInput
				class="mx-4"
				placeholder={$t('ai_chat.input.placeholder')}
				suggestions={isPro ? suggestions : []}
				showFileButton={isPro}
				showHandoffButton={false}
				isRateLimited={!isPro}
				onSend={async (prompt) => {
					if (!isPro || !prompt?.trim()) return;

					try {
						await chatCore.sendMessage(client, prompt, {
							fileIds: chatUIContext.uploadedFileIds,
							attachments: chatUIContext.attachments
						});
						chatUIContext.clearAttachments();
						onMessageSent?.();
					} catch (error) {
						console.error('[AI Chat sendMessage] Error:', error);
						toast.error($t('chat.messages.send_failed'));
					}
				}}
			/>
		</div>
	</ChatRoot>
</div>
