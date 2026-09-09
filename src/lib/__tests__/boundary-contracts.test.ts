import type { ComponentProps } from 'svelte';
import type ChatRoot from '$lib/chat/ui/ChatRoot.svelte';
import { describe, expectTypeOf, it } from 'vitest';
import type { FunctionArgs, FunctionReturnType } from 'convex/server';
import type { api } from '$lib/convex/_generated/api';
import type { ChatCore, ChatCoreAPI } from '$lib/chat/core/chat-core.svelte.ts';
import type { ChatCoreErrorCode } from '$lib/chat';
import type { ChatSessionPort, StreamCachePort } from '$lib/chat/core/chat-session-port';
import type { ChatUIContext } from '$lib/chat/ui/chat-context.svelte.ts';
import type {
	ChatMessagesQuery,
	MessagesQueryResponse,
	SendMessageResult
} from '$lib/chat/core/types';
import type { SupportConversation } from '$lib/components/customer-support/support-conversation.svelte.ts';
import type { SupportContext } from '$lib/components/customer-support/support-context.svelte.ts';
import type {
	SupportHandoffCommands,
	SupportHandoffConversationPort
} from '$lib/components/customer-support/support-handoff-commands.svelte.ts';
import type {
	SupportNotificationCommands,
	SupportNotificationConversationPort
} from '$lib/components/customer-support/support-notification-commands.svelte.ts';
import type {
	AttachmentTransferOptions,
	AttachmentTransferPayload,
	AttachmentTransferSnapshot,
	AttachmentTransferUpload
} from '$lib/chat/ui/attachment-transfer';
import type { UploadConfig } from '$lib/chat/ui/composer-attachment-coordinator.svelte.ts';
import type { ChatUploadCommitResult, UploadResult } from '$lib/chat/core/file-uploader';
import type { UploadGrant } from '$lib/uploads/transfer';
import type {
	BillingCheckoutDeps,
	CheckoutStartParams
} from '$lib/components/billing/checkout-context.svelte.ts';
import type { CheckoutAttachOption } from '$lib/billing/checkout-result';
import type { AttachResult, CheckoutResult } from '@stickerdaniel/convex-autumn-svelte/sveltekit';
import type {
	CommandRunnerDependencies,
	SpawnCommand,
	SpawnedCommand
} from '../../../scripts/process/command-runner';
import type { createDeploymentExecution } from '../../../scripts/deploy/execution';
import type { authClient, updateUserWithLocale } from '$lib/auth-client';
import type { ShapeUpdate } from '$lib/components/customer-support/screenshot-editor/types';

describe('first-party boundary compile-time contracts', () => {
	it('shares a structural chat session, never a concrete manager', () => {
		expectTypeOf<ChatCore>().toExtend<ChatSessionPort>();
		expectTypeOf<SupportConversation>().toExtend<ChatSessionPort>();
		expectTypeOf<ConstructorParameters<typeof ChatUIContext>[0]>().toEqualTypeOf<ChatSessionPort>();
		expectTypeOf<
			ComponentProps<typeof ChatRoot>['externalCore']
		>().toEqualTypeOf<ChatSessionPort>();
		expectTypeOf<{ api: never }>().not.toExtend<
			Pick<ComponentProps<typeof ChatRoot>, 'externalCore'>
		>();
		expectTypeOf<ChatSessionPort['streamCache']>().toEqualTypeOf<StreamCachePort>();
		expectTypeOf<ChatSessionPort['setAwaitingStream']>().toEqualTypeOf<
			(awaiting: boolean) => void
		>();
		expectTypeOf<ChatCore['error']>().toEqualTypeOf<ChatCoreErrorCode | null>();
		expectTypeOf<Parameters<ChatCore['setError']>[0]>().toEqualTypeOf<ChatCoreErrorCode | null>();
		expectTypeOf<{ threadId: number }>().not.toExtend<ChatSessionPort>();
	});
	it('separates message subscriptions from the surface-owned send contract', () => {
		expectTypeOf<ComponentProps<typeof ChatRoot>['api']>().toEqualTypeOf<{
			listMessages: ChatMessagesQuery;
		}>();
		expectTypeOf<
			FunctionReturnType<typeof api.admin.support.mutations.sendAdminReply>
		>().toEqualTypeOf<null>();
		expectTypeOf<typeof api.admin.support.mutations.sendAdminReply>().not.toExtend<
			ChatCoreAPI['sendMessage']
		>();
	});
	it('keeps support collaborators independent of the composition root', () => {
		expectTypeOf<SupportContext['conversation']>().toEqualTypeOf<SupportConversation>();
		expectTypeOf<SupportConversation>().toExtend<SupportHandoffConversationPort>();
		expectTypeOf<SupportConversation>().toExtend<SupportNotificationConversationPort>();
		expectTypeOf<
			ConstructorParameters<typeof SupportHandoffCommands>[0]
		>().toEqualTypeOf<SupportHandoffConversationPort>();
		expectTypeOf<
			ConstructorParameters<typeof SupportNotificationCommands>[0]
		>().toEqualTypeOf<SupportNotificationConversationPort>();
	});
	it('carries query envelopes and mutation results without default-any function references', () => {
		expectTypeOf<
			FunctionReturnType<ChatCoreAPI['sendMessage']>
		>().toEqualTypeOf<SendMessageResult>();
		expectTypeOf<FunctionReturnType<ChatCoreAPI['sendMessage']>>().not.toBeAny();
		expectTypeOf<FunctionReturnType<ChatMessagesQuery>>().toEqualTypeOf<unknown>();
		expectTypeOf<MessagesQueryResponse['page'][number]>().not.toBeAny();
		expectTypeOf<typeof api.aiChat.messages.listMessages>().toExtend<ChatMessagesQuery>();
		expectTypeOf<typeof api.support.messages.listMessages>().toExtend<ChatMessagesQuery>();
		expectTypeOf<
			typeof api.admin.support.queries.listMessagesForAdmin
		>().toExtend<ChatMessagesQuery>();
		expectTypeOf<FunctionArgs<ChatCoreAPI['sendMessage']>>().not.toBeAny();
		expectTypeOf<{ threadId: string; prompt: number }>().not.toExtend<
			FunctionArgs<ChatCoreAPI['sendMessage']>
		>();
	});
	it('preserves attachment snapshots, transport payloads, and endpoint results', () => {
		expectTypeOf<AttachmentTransferOptions['onSnapshot']>().toEqualTypeOf<
			(snapshot: AttachmentTransferSnapshot) => void
		>();
		expectTypeOf<Parameters<AttachmentTransferUpload>>().toEqualTypeOf<
			[AttachmentTransferPayload, (progress: number) => void, AbortSignal]
		>();
		expectTypeOf<ReturnType<AttachmentTransferUpload>>().toEqualTypeOf<Promise<UploadResult>>();
		expectTypeOf<
			FunctionReturnType<UploadConfig['generateUploadUrl']>
		>().toEqualTypeOf<UploadGrant>();
		expectTypeOf<
			FunctionReturnType<UploadConfig['saveUploadedFile']>
		>().toEqualTypeOf<ChatUploadCommitResult>();
		expectTypeOf<FunctionReturnType<UploadConfig['saveUploadedFile']>>().not.toBeAny();
		expectTypeOf<{ uploadUrl: number; uploadToken: string }>().not.toExtend<UploadGrant>();
		expectTypeOf<Extract<keyof ShapeUpdate, 'type' | 'id'>>().toEqualTypeOf<never>();
		expectTypeOf<typeof api.support.files.generateUploadUrl>().toExtend<
			UploadConfig['generateUploadUrl']
		>();
		expectTypeOf<typeof api.support.files.saveUploadedFile>().toExtend<
			UploadConfig['saveUploadedFile']
		>();
		expectTypeOf<typeof api.aiChat.files.generateUploadUrl>().toExtend<
			UploadConfig['generateUploadUrl']
		>();
		expectTypeOf<typeof api.aiChat.files.saveUploadedFile>().toExtend<
			UploadConfig['saveUploadedFile']
		>();
	});
	it('infers the auth locale input from the actual server configuration', () => {
		expectTypeOf<
			NonNullable<Parameters<typeof authClient.updateUser>[0]>['locale']
		>().toEqualTypeOf<string | null | undefined>();
		expectTypeOf<Parameters<typeof updateUserWithLocale>[0]['locale']>().toEqualTypeOf<
			string | undefined
		>();
		expectTypeOf<{ locale: number }>().not.toExtend<Parameters<typeof authClient.updateUser>[0]>();
	});
	it('checks billing inputs and nullable operation results separately from session state', () => {
		expectTypeOf<Parameters<BillingCheckoutDeps['checkout']['execute']>>().toEqualTypeOf<
			[CheckoutStartParams]
		>();
		expectTypeOf<ReturnType<BillingCheckoutDeps['checkout']['execute']>>().toEqualTypeOf<
			Promise<CheckoutResult | null>
		>();
		expectTypeOf<ReturnType<BillingCheckoutDeps['attach']['execute']>>().toEqualTypeOf<
			Promise<AttachResult | null>
		>();
		expectTypeOf<CheckoutStartParams['options']>().toEqualTypeOf<
			CheckoutAttachOption[] | undefined
		>();
		expectTypeOf<{ productId: number }>().not.toExtend<CheckoutStartParams>();
		expectTypeOf<{
			productId: string;
			options: Array<{ featureId: string; quantity: string }>;
		}>().not.toExtend<CheckoutStartParams>();
	});
	it('injects the command-runner port into deployment without a concrete process cast', () => {
		expectTypeOf<CommandRunnerDependencies['spawn']>().toEqualTypeOf<SpawnCommand>();
		expectTypeOf<ReturnType<SpawnCommand>>().toEqualTypeOf<SpawnedCommand>();
		expectTypeOf<
			NonNullable<Parameters<typeof createDeploymentExecution>[0]>['runner']
		>().toEqualTypeOf<Partial<CommandRunnerDependencies> | undefined>();
	});
});
