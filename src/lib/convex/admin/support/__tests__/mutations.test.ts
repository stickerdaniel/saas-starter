import { beforeEach, describe, expect, it, vi } from 'vitest';

// sendAdminReply is an adminMutation, so its _handler first runs the customCtx
// that calls authComponent.getAuthUser. Mock auth to hand back an admin user and
// keep the rest of the module graph light.
vi.mock('../../../auth', () => ({
	authComponent: {
		getAuthUser: vi.fn(),
		safeGetAuthUser: vi.fn()
	}
}));

vi.mock('@convex-dev/agent', () => ({
	saveMessage: vi.fn(),
	getFile: vi.fn()
}));

vi.mock('../../../support/threads', () => ({
	shouldSendNotification: vi.fn(() => false),
	syncSupportLastMessage: vi.fn()
}));

vi.mock('../../../constants', () => ({ MAX_MESSAGE_LENGTH: 4000 }));

vi.mock('../../../i18n/translations', () => ({
	t: vi.fn(() => 'translated')
}));

vi.mock('../../../_generated/api', () => ({
	components: { agent: {} },
	internal: {
		admin: {
			support: {
				notifications: {
					cancelPendingNotification:
						'internal.admin.support.notifications.cancelPendingNotification'
				}
			}
		},
		emails: {
			send: { sendAdminReplyNotification: 'internal.emails.send.sendAdminReplyNotification' }
		}
	}
}));

import { saveMessage, getFile } from '@convex-dev/agent';
import { authComponent } from '../../../auth';
import { shouldSendNotification } from '../../../support/threads';
import { sendAdminReply } from '../mutations';

const saveMessageMock = saveMessage as unknown as ReturnType<typeof vi.fn>;
const getFileMock = getFile as unknown as ReturnType<typeof vi.fn>;
const getAuthUserMock = authComponent.getAuthUser as unknown as ReturnType<typeof vi.fn>;
const shouldSendNotificationMock = shouldSendNotification as unknown as ReturnType<typeof vi.fn>;

type RegisteredFunction<TArgs, TResult> = {
	_handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const replyHandler = sendAdminReply as unknown as RegisteredFunction<
	{ threadId: string; prompt: string; fileIds?: string[] },
	null
>;

function makeCtx({ notificationEmail }: { notificationEmail?: string } = {}) {
	return {
		db: {
			query: vi.fn(() => ({
				withIndex: vi.fn(() => ({
					first: vi.fn().mockResolvedValue({
						_id: 'st_1',
						threadId: 't1',
						assignedTo: undefined,
						notificationEmail,
						notificationSentAt: undefined
					})
				}))
			})),
			patch: vi.fn()
		},
		scheduler: { runAfter: vi.fn() }
	};
}

// An admin reply persists human-provenance metadata (provider + adminUserId) that
// the UI relies on to distinguish it from an AI answer. Forwarding attachment
// fileIds must add to that metadata, never replace the provider fields, and a
// text-only reply must not gain a fileIds key.
describe('sendAdminReply', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getAuthUserMock.mockResolvedValue({
			_id: 'admin_1',
			role: 'admin',
			name: 'Admin User',
			email: 'admin@example.com'
		});
		shouldSendNotificationMock.mockReturnValue(false);
		saveMessageMock.mockResolvedValue({ messageId: 'm1' });
		getFileMock.mockResolvedValue({
			filePart: {
				type: 'file',
				data: new URL('https://files/f1'),
				mediaType: 'image/png',
				filename: 'f1.png'
			}
		});
	});

	it('merges fileIds into the human metadata without dropping provider fields', async () => {
		const ctx = makeCtx();

		await replyHandler._handler(ctx, { threadId: 't1', prompt: 'hi', fileIds: ['file_1'] });

		// Standalone saveMessage(ctx, components.agent, args) -> args is index [2].
		const metadata = saveMessageMock.mock.calls[0][2].metadata;
		expect(metadata.provider).toBe('human');
		expect(metadata.providerMetadata.admin).toMatchObject({
			isAdminMessage: true,
			adminUserId: 'admin_1'
		});
		expect(metadata.fileIds).toEqual(['file_1']);
	});

	it('omits fileIds for a text-only reply', async () => {
		const ctx = makeCtx();

		await replyHandler._handler(ctx, { threadId: 't1', prompt: 'hi' });

		const metadata = saveMessageMock.mock.calls[0][2].metadata;
		expect(metadata.provider).toBe('human');
		expect(metadata.providerMetadata.admin.isAdminMessage).toBe(true);
		expect('fileIds' in metadata).toBe(false);
	});

	it('marks the human reply unread for the customer', async () => {
		const ctx = makeCtx();

		await replyHandler._handler(ctx, { threadId: 't1', prompt: 'hi' });

		expect(ctx.db.patch).toHaveBeenCalledWith(
			'st_1',
			expect.objectContaining({
				awaitingAdminResponse: false,
				hasUnreadAdminReply: true,
				lastAdminReplyAt: expect.any(Number),
				lastAdminReplyMessageId: 'm1'
			})
		);
		const patch = ctx.db.patch.mock.calls[0][1];
		expect(patch.updatedAt).toBe(patch.lastAdminReplyAt);
	});

	it('marks a truncated email preview with an ellipsis', async () => {
		shouldSendNotificationMock.mockReturnValue(true);
		const ctx = makeCtx({ notificationEmail: 'user@example.com' });

		await replyHandler._handler(ctx, {
			threadId: 't1',
			prompt: 'a'.repeat(201)
		});

		expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
			0,
			'internal.emails.send.sendAdminReplyNotification',
			expect.objectContaining({ messagePreview: `${'a'.repeat(199)}…` })
		);
	});
});
