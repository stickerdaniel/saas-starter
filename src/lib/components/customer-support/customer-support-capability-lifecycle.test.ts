import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
import type { ConvexClient } from 'convex/browser';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import en from '../../../i18n/en.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('$app/environment', () => ({ browser: true }));

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
	urlState: { support: '' as '' | 'open', thread: '' }
}));

vi.mock('$app/state', () => ({ page: state.page }));
vi.mock('$lib/auth-client', () => ({
	authClient: {
		useSession: () => ({
			subscribe: (callback: (value: { data: null; isPending: false }) => void) => {
				callback({ data: null, isPending: false });
				return () => {};
			}
		})
	}
}));
vi.mock('@mmailaender/convex-better-auth-svelte/svelte', () => ({
	useAuth: () => ({ isAuthenticated: false, isLoading: false })
}));
vi.mock('$lib/components/customer-support/use-support-url-state.svelte.ts', () => ({
	useSupportUrlState: () => state.urlState
}));
vi.mock('$lib/components/customer-support/support-user-id.svelte.ts', () => ({
	supportUserId: { current: null }
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

import ChatTestProvider from '$lib/chat/ui/test-fixtures/ChatTestProvider.svelte';
import CustomerSupport from './customer-support.svelte';
import { supportThreadContext } from './support-thread-context.svelte.ts';

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
		const setContext = vi.spyOn(supportThreadContext, 'set');
		await mountSupport();
		const thread = setContext.mock.calls[0]![0];

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
		await expect(thread.sendMessage(null as never, 'Second message')).rejects.toThrow(
			'Cannot send message: waiting for AI response'
		);
	});
});
