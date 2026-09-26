import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspect } from 'node:util';
import { getFunctionName } from 'convex/server';
import type { ConvexClient } from 'convex/browser';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import en from '../../../i18n/en.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('$app/environment', () => ({ browser: true, dev: false }));

const state = vi.hoisted(() => ({
	page: {
		data: {
			lang: 'en',
			capabilitiesResolved: false,
			capabilities: {
				billing: { usable: false, reason: 'unavailable' as const },
				ai: { usable: false, reason: 'unavailable' as const }
			}
		},
		url: new URL('https://example.com/en')
	},
	urlState: { support: '' as '' | 'open', thread: '' },
	auth: { isAuthenticated: false, isLoading: false },
	session: null as { user: { id: string } } | null,
	supportUserId: { current: null as string | null }
}));

const snapdom = vi.hoisted(() => ({ snapdom: vi.fn(), preCache: vi.fn() }));

vi.mock('$app/state', () => ({ page: state.page }));
vi.mock('$lib/auth-client', () => ({
	authClient: {
		useSession: () => ({
			subscribe: (
				callback: (value: { data: { user: { id: string } } | null; isPending: false }) => void
			) => {
				callback({ data: state.session, isPending: false });
				return () => {};
			}
		})
	}
}));
vi.mock('@mmailaender/convex-better-auth-svelte/svelte', () => ({
	useAuth: () => state.auth
}));
vi.mock('$lib/components/customer-support/use-support-url-state.svelte.ts', () => ({
	useSupportUrlState: () => state.urlState
}));
vi.mock('$lib/components/customer-support/support-user-id.svelte.ts', () => ({
	supportUserId: state.supportUserId
}));
vi.mock('$lib/components/customer-support/support-unread-state.svelte.ts', () => ({
	useSupportUnreadState: () => ({ hasUnread: false, count: 0 })
}));
vi.mock('$lib/hooks/use-media.svelte.ts', () => ({
	useMedia: () => ({ sm: false, lg: false, xl: false })
}));
vi.mock('$lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('$lib/monitoring/sentry', () => ({ loadSentry: vi.fn() }));
vi.mock('$lib/chat', () => ({
	ChatAttachmentStore: class ChatAttachmentStore {},
	ChatUIContext: class ChatUIContext {
		dispose() {}
	}
}));
vi.mock('$lib/components/customer-support/feedback-widget.svelte', async () => ({
	default: (
		await import('$lib/components/customer-support/test-fixtures/CapabilityFeedbackWidget.svelte')
	).default
}));
// Konva needs a real canvas; the capture failure happens before any annotation is exported.
vi.mock('$lib/components/customer-support/screenshot-editor/ScreenshotCanvas.svelte', () => ({
	default: () => {}
}));
vi.mock('@zumer/snapdom', () => snapdom);

import ChatTestProvider from '$lib/chat/ui/test-fixtures/ChatTestProvider.svelte';
import CustomerSupport from './customer-support.svelte';
import SupportTicketMigrationBootstrap from './support-ticket-migration-bootstrap.svelte';
import ScreenshotEditor from './screenshot-editor/ScreenshotEditor.svelte';
import { screenshotEditorContext } from './screenshot-editor/screenshot-editor-context.svelte.ts';
import { supportContext } from './support-context.svelte.ts';

let component: ReturnType<typeof mount> | undefined;
let queryValue: unknown;
let publishCapability: ((value: unknown) => void) | undefined;
let publishError: ((error: Error) => void) | undefined;
let client: ConvexClient;

function feedbackLauncher(): HTMLButtonElement {
	return document.querySelector<HTMLButtonElement>(
		`button[aria-label="${en.aria.feedback_open}"], button[aria-label="${en.aria.feedback_close}"]`
	)!;
}

async function mountSupport(): Promise<void> {
	component = mount(ChatTestProvider<Record<string, never>>, {
		target: document.body,
		props: {
			client,
			content: CustomerSupport,
			contentProps: {}
		}
	});
	await tick();
	await vi.waitFor(() => expect(publishCapability).toBeTypeOf('function'));
}

beforeEach(() => {
	queryValue = undefined;
	publishCapability = undefined;
	publishError = undefined;
	state.page.data.capabilitiesResolved = false;
	state.urlState.support = '';
	state.urlState.thread = '';
	state.auth.isAuthenticated = false;
	state.session = null;
	state.supportUserId.current = null;
	const onUpdate = vi.fn((reference, _args, onValue, onError) => {
		if (getFunctionName(reference) === 'capabilities:getUsability') {
			publishCapability = onValue;
			publishError = onError;
		}
		return () => {};
	});
	client = {
		disabled: false,
		closed: false,
		client: { localQueryResult: () => queryValue },
		onUpdate,
		mutation: vi.fn(),
		query: vi.fn()
	} as unknown as ConvexClient;
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

describe('customer support capability lifecycle', () => {
	it('keeps every message entry closed through a client query error, then enables human support', async () => {
		state.urlState.support = 'open';
		await mountSupport();

		expect(feedbackLauncher().disabled).toBe(true);
		expect(document.querySelector('[data-testid="support-message-send"]')).toBeNull();

		publishError!(new Error('temporary capability failure'));
		await tick();
		expect(feedbackLauncher().disabled).toBe(true);
		expect(document.querySelector('[data-testid="support-message-send"]')).toBeNull();

		queryValue = {
			billing: { usable: false, reason: 'unavailable' },
			ai: { usable: false, reason: 'unavailable' }
		};
		publishCapability!(queryValue);
		await tick();

		expect(feedbackLauncher().disabled).toBe(false);
		expect(document.querySelector('[data-testid="support-message-send"]')).not.toBeNull();
		expect(document.body.textContent).not.toContain(en.support.chatbar.disclosure);
	});

	it('enables the AI disclosure and reply lock together after capability recovery', async () => {
		const setContext = vi.spyOn(supportContext, 'set');
		await mountSupport();
		const thread = setContext.mock.calls[0]![0].conversation;

		expect(feedbackLauncher().disabled).toBe(true);
		expect(thread.awaitsAgentReply).toBe(false);
		expect(document.body.textContent).not.toContain(en.support.chatbar.disclosure);

		queryValue = {
			billing: { usable: false, reason: 'unavailable' },
			ai: { usable: true }
		};
		publishCapability!(queryValue);
		await tick();

		expect(feedbackLauncher().disabled).toBe(false);
		expect(document.body.textContent).toContain(en.support.chatbar.disclosure);
		expect(thread.awaitsAgentReply).toBe(true);
		thread.setSending(true);
		await expect(thread.sendMessage(null as never, 'Second message')).rejects.toMatchObject({
			code: 'send_in_progress'
		});
	});
});

describe('customer support diagnostics', () => {
	// Carried by every rejected operation below; no console argument may reveal it.
	const secret = 'provider-secret-5a';
	let consoleOutput: () => string;

	beforeEach(() => {
		const spies = (['error', 'warn', 'info', 'log', 'debug'] as const).map((method) =>
			vi.spyOn(console, method).mockImplementation(() => {})
		);
		consoleOutput = () =>
			inspect(
				spies.map((spy) => spy.mock.calls),
				{ depth: null }
			);
	});

	it('drops an unresolvable thread link with a fixed warning', async () => {
		state.urlState.thread = 'thread-from-link';
		vi.mocked(client.query).mockRejectedValue(new Error(secret));
		await mountSupport();

		await vi.waitFor(() => expect(state.urlState.thread).toBe(''));
		expect(getFunctionName(vi.mocked(client.query).mock.calls[0]![0])).toBe(
			'support/threads:getThread'
		);
		expect(console.warn).toHaveBeenCalledExactlyOnceWith(
			'[CustomerSupport.resolveThreadUrl] Invalid'
		);
		expect(consoleOutput()).not.toContain(secret);
	});

	it('keeps the anonymous identity after a failed ticket migration', async () => {
		state.auth.isAuthenticated = true;
		state.session = { user: { id: 'user-1' } };
		state.supportUserId.current = 'anon_visitor';
		vi.mocked(client.mutation).mockRejectedValue(new Error(secret));
		component = mount(ChatTestProvider<Record<string, never>>, {
			target: document.body,
			props: { client, content: SupportTicketMigrationBootstrap, contentProps: {} }
		});

		await vi.waitFor(() =>
			expect(console.error).toHaveBeenCalledExactlyOnceWith(
				'[SupportMigration.migrateAnonymousTickets] Failed'
			)
		);
		const [reference, args] = vi.mocked(client.mutation).mock.calls[0]!;
		expect(getFunctionName(reference)).toBe('support/migration:migrateAnonymousTickets');
		expect(args).toEqual({ anonymousUserId: 'anon_visitor' });
		expect(state.supportUserId.current).toBe('anon_visitor');
		expect(consoleOutput()).not.toContain(secret);
	});

	it('clears the anonymous identity only after the last migration page', async () => {
		state.auth.isAuthenticated = true;
		state.session = { user: { id: 'user-1' } };
		state.supportUserId.current = 'anon_visitor';
		vi.mocked(client.mutation)
			.mockResolvedValueOnce({ migratedCount: 100, done: false })
			.mockResolvedValueOnce({ migratedCount: 5, done: true });
		component = mount(ChatTestProvider<Record<string, never>>, {
			target: document.body,
			props: { client, content: SupportTicketMigrationBootstrap, contentProps: {} }
		});

		await vi.waitFor(() => expect(state.supportUserId.current).toBeNull());
		expect(client.mutation).toHaveBeenCalledTimes(2);
		expect(vi.mocked(client.mutation).mock.calls[1]![1]).toEqual({
			anonymousUserId: 'anon_visitor'
		});
	});

	it('keeps the anonymous identity when the migration does not finish', async () => {
		state.auth.isAuthenticated = true;
		state.session = { user: { id: 'user-1' } };
		state.supportUserId.current = 'anon_visitor';
		vi.mocked(client.mutation).mockResolvedValue({ migratedCount: 100, done: false });
		component = mount(ChatTestProvider<Record<string, never>>, {
			target: document.body,
			props: { client, content: SupportTicketMigrationBootstrap, contentProps: {} }
		});

		await vi.waitFor(() =>
			expect(console.error).toHaveBeenCalledExactlyOnceWith(
				'[SupportMigration.migrateAnonymousTickets] Unfinished'
			)
		);
		expect(state.supportUserId.current).toBe('anon_visitor');
	});

	describe('screenshot editor', () => {
		const onCaptureError = vi.fn();
		let editor: ReturnType<typeof screenshotEditorContext.get>;

		beforeEach(async () => {
			onCaptureError.mockReset();
			snapdom.preCache.mockReset().mockResolvedValue(undefined);
			snapdom.snapdom.mockReset();
			const setEditor = vi.spyOn(screenshotEditorContext, 'set');
			component = mount(ChatTestProvider<{ onCaptureError: (error: unknown) => void }>, {
				target: document.body,
				props: { client, content: ScreenshotEditor, contentProps: { onCaptureError } }
			});
			await tick();
			editor = setEditor.mock.results[0]!.value;
		});

		it('keeps drawing after a failed pre-cache with a fixed warning', async () => {
			snapdom.preCache.mockRejectedValue(new Error(secret));

			editor.startDrawing(10, 10);

			await vi.waitFor(() =>
				expect(console.warn).toHaveBeenCalledExactlyOnceWith('[ScreenshotEditor.preCache] Failed')
			);
			expect(editor.isDrawing).toBe(true);
			expect(consoleOutput()).not.toContain(secret);
		});

		it('hands a failed capture to its owner without logging the error', async () => {
			const captureError = new Error(secret);
			snapdom.snapdom.mockRejectedValue(captureError);
			editor.addShape(editor.createRectShape(10, 10));
			await tick();
			const save = document.querySelector<HTMLButtonElement>(
				`button[aria-label="${en.support.screenshot.next}"]`
			)!;

			save.click();

			await vi.waitFor(() => expect(onCaptureError).toHaveBeenCalledExactlyOnceWith(captureError));
			expect(console.error).toHaveBeenCalledExactlyOnceWith('[ScreenshotEditor.capture] Failed');
			await tick();
			expect(save.disabled).toBe(false);
			expect(consoleOutput()).not.toContain(secret);
		});
	});
});
