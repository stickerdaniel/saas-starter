<script lang="ts">
	import { useConvexClient } from 'convex-svelte';
	import { toast } from 'svelte-sonner';
	import { watch } from 'runed';
	import { api } from '$lib/convex/_generated/api';
	import ChatRoot from '$lib/chat/ui/ChatRoot.svelte';
	import ChatMessages from '$lib/chat/ui/ChatMessages.svelte';
	import ChatInput from '$lib/chat/ui/ChatInput.svelte';
	import { PromptSuggestion } from '$lib/components/prompt-kit/prompt-suggestion';
	import { ChatUIContext, type UploadConfig } from '$lib/chat/ui/chat-context.svelte.ts';
	import { ChatCore } from '$lib/chat/core/chat-core.svelte.ts';
	import { ChatDraftManager } from '$lib/chat/core/chat-draft-manager.svelte.ts';
	import { ComposerSendCoordinator } from '$lib/chat/ui/composer-send-coordinator.ts';
	import { ChatAttachmentStore } from '$lib/chat/core/chat-attachment-store.svelte.ts';
	import MessageQuotaBanner from '$lib/components/message-quota-banner.svelte';
	import { getTranslate } from '@tolgee/svelte';
	import { page } from '$app/state';
	import { onDestroy, tick } from 'svelte';
	import { activeUploadsContext } from '$lib/hooks/active-uploads.svelte.ts';
	import {
		getChatSessionEpoch,
		isChatSessionCurrent
	} from '$lib/chat/core/chat-persisted-state.ts';

	const { t } = getTranslate();

	let {
		threadId,
		isPro = false,
		hasMessagesAvailable = false,
		remainingMessages = 0,
		totalMessages = 0,
		onUpgrade,
		isUpgrading = false,
		onMessageSent,
		sendOwner
	}: {
		threadId: string;
		isPro?: boolean;
		hasMessagesAvailable?: boolean;
		remainingMessages?: number;
		totalMessages?: number;
		onUpgrade?: () => void;
		isUpgrading?: boolean;
		onMessageSent?: () => void;
		/** Settles sends past this component; the page owns it so a remount keeps it. */
		sendOwner?: ComposerSendCoordinator;
	} = $props();

	const client = useConvexClient();

	const uploadConfig: UploadConfig = {
		generateUploadUrl: api.aiChat.files.generateUploadUrl,
		saveUploadedFile: api.aiChat.files.saveUploadedFile,
		getAttachmentText: api.aiChat.files.getAttachmentText,
		locale: page.data.lang,
		translate: (key, params) => $t(key, params),
		getAccessKey: () => threadId || 'ai-chat',
		attachmentStore: new ChatAttachmentStore('ai-chat')
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

	// Draft persistence across thread switches and page refreshes
	const draftManager = new ChatDraftManager('ai-chat');
	// The owner is fixed for this component's lifetime; one made here is mounted here.
	// svelte-ignore state_referenced_locally
	const ownsSendOwner = !sendOwner;
	// svelte-ignore state_referenced_locally
	const owner = sendOwner ?? new ComposerSendCoordinator({ drafts: draftManager });
	if (ownsSendOwner) onDestroy(owner.mount());

	// Report transfers to the app so a navigation that would kill one asks first.
	// Absent outside the app shell (isolated tests, the standalone example), where
	// there is no layout to ask.
	const chatUIContext = new ChatUIContext(
		chatCore,
		client,
		uploadConfig,
		'right',
		activeUploadsContext.getOr(null),
		{
			bindThreadOrigin: (binder) => chatCore.setThreadOriginBinder(binder),
			forgetSession: () => chatCore.forgetChatSession(),
			sendOwner: owner
		}
	);

	// Revoke blob preview URLs of unsent attachments when this thread view unmounts
	onDestroy(() => chatUIContext.dispose());

	// Save draft on leave, restore on enter
	watch(
		() => threadId,
		(current, previous) => {
			if (previous && chatUIContext.inputValue.trim()) {
				draftManager.setDraft(previous, chatUIContext.inputValue);
			}
			chatUIContext.loadDraft(current);
		}
	);

	// Continuous save for refresh persistence — watch untracks the callback,
	// avoiding a reactive loop with PersistedState's Proxy set trap. A composer
	// emptied by a send keeps the stored copy, which that send still owns.
	watch(
		() => [chatUIContext.inputValue, threadId] as const,
		([value, id]) => {
			if (!value.trim() && owner.holdsDraft(id)) return;
			draftManager.setDraft(id, value);
		}
	);

	// Auto-focus input when thread changes
	let chatContainer: HTMLDivElement | undefined = $state();

	$effect(() => {
		void threadId;
		if (!chatContainer) return;
		tick().then(() => {
			chatContainer?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
		});
	});

	const suggestions = $derived([
		{ text: $t('ai_chat.suggestion.weather'), label: $t('ai_chat.suggestion.weather') },
		{ text: $t('ai_chat.suggestion.explain'), label: $t('ai_chat.suggestion.explain') },
		{ text: $t('ai_chat.suggestion.help'), label: $t('ai_chat.suggestion.help') }
	]);
</script>

<div bind:this={chatContainer} class="flex h-full flex-col">
	<ChatRoot
		threadId={threadId || null}
		externalCore={chatCore}
		externalUIContext={chatUIContext}
		api={{ listMessages: api.aiChat.messages.listMessages }}
	>
		<div class="flex-1 overflow-hidden">
			<ChatMessages />
		</div>

		<div class="relative z-20 mx-auto w-full max-w-3xl -translate-y-4">
			{#if (chatCore.isNewConversation || chatUIContext.messagesReady) && chatUIContext.displayMessages.length === 0 && !chatUIContext.inputValue.trim() && hasMessagesAvailable && suggestions.length > 0}
				<div class="mx-4 pb-2">
					{#key chatCore.threadGeneration}
						<div class="flex flex-wrap gap-2">
							{#each suggestions as suggestion, i (suggestion.text)}
								<div
									class="max-w-full min-w-0 motion-safe:animate-chip-in motion-safe:animation-delay-var sm:max-w-56"
									style:--delay="{i * 50}ms"
								>
									<PromptSuggestion
										class="w-full"
										truncate
										title={suggestion.text}
										onclick={() => {
											chatUIContext.setInputValue(suggestion.text);
											tick().then(() => {
												chatContainer?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
											});
										}}
									>
										{suggestion.label}
									</PromptSuggestion>
								</div>
							{/each}
						</div>
					{/key}
				</div>
			{/if}
			<MessageQuotaBanner
				{isPro}
				{hasMessagesAvailable}
				remaining={remainingMessages}
				total={totalMessages}
				{onUpgrade}
				{isUpgrading}
			/>
			<ChatInput
				class="mx-4"
				compact
				placeholder={$t('ai_chat.input.placeholder')}
				suggestions={[]}
				showFileButton={hasMessagesAvailable}
				showHandoffButton={false}
				isRateLimited={!hasMessagesAvailable}
				onSend={async (prompt) => {
					if (!hasMessagesAvailable || !prompt?.trim()) return;
					const originThreadId = threadId;
					const sessionEpoch = getChatSessionEpoch();
					const fileIds = chatUIContext.uploadedFileIds;
					const attachments = [...chatUIContext.attachments];
					try {
						await chatCore.sendMessage(client, prompt, { fileIds, attachments });
						if (!isChatSessionCurrent(sessionEpoch) || threadId !== originThreadId) return;
						onMessageSent?.();
					} catch (error) {
						if (isChatSessionCurrent(sessionEpoch) && threadId === originThreadId) {
							console.error('[AIChat.sendMessage] Failed');
							toast.error($t('chat.messages.send_failed'));
						}
						throw error;
					}
				}}
			/>
			<p
				class="pointer-events-none mt-1.5 px-4 pb-2 text-center text-xs text-balance text-muted-foreground"
			>
				{$t('support.chatbar.disclosure')}
			</p>
		</div>
	</ChatRoot>
</div>
