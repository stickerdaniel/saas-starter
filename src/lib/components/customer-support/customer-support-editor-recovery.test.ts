import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConvexClient } from 'convex/browser';
import { mount, unmount } from 'svelte';
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
			capabilitiesResolved: true,
			capabilities: {
				billing: { usable: false, reason: 'unavailable' as const },
				ai: { usable: false, reason: 'unavailable' as const }
			}
		},
		url: new URL('https://example.com/en')
	},
	urlState: { support: 'open' as '' | 'open', thread: '' }
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

let component: ReturnType<typeof mount> | undefined;
const unhandledRejections: unknown[] = [];
const recordRejection = (reason: unknown) => unhandledRejections.push(reason);

function button(name: string): HTMLButtonElement | undefined {
	return [...document.querySelectorAll<HTMLButtonElement>('button')].find(
		(candidate) => (candidate.getAttribute('aria-label') ?? candidate.textContent) === name
	);
}

beforeEach(() => {
	unhandledRejections.length = 0;
	process.on('unhandledRejection', recordRejection);
	const client = {
		disabled: false,
		closed: false,
		client: { localQueryResult: () => state.page.data.capabilities },
		onUpdate: vi.fn(() => () => {}),
		mutation: vi.fn(),
		query: vi.fn()
	} as unknown as ConvexClient;
	component = mount(ChatTestProvider<Record<string, never>>, {
		target: document.body,
		props: { client, content: CustomerSupport, contentProps: {} }
	});
});

afterEach(async () => {
	process.off('unhandledRejection', recordRejection);
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
});

async function expectCaptureErrorRecovery(): Promise<void> {
	button('Screenshot')!.click();

	const dialog = await vi.waitFor(() => {
		const element = document.querySelector('[role="alertdialog"]');
		expect(element, 'capture-error dialog').not.toBeNull();
		return element!;
	});
	const title = document.getElementById(dialog.getAttribute('aria-labelledby')!);
	expect(title?.textContent).toBe(en.support.screenshot.error.title);
	expect(
		document.querySelector(`[role="dialog"][aria-label="${en.support.screenshot.aria_label}"]`)
	).toBeNull();
	expect(button(en.aria.feedback_close)?.disabled).toBe(false);

	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(unhandledRejections).toEqual([]);
}

describe('customer support screenshot editor', () => {
	it('offers the capture-error dialog when the editor chunk fails to load', async () => {
		// A deploy deleted the editor chunk under the open page: the import rejects.
		vi.doMock('./screenshot-editor/ScreenshotEditor.svelte', () => {
			throw new TypeError('Failed to fetch dynamically imported module');
		});
		await expectCaptureErrorRecovery();
	});

	it('offers the capture-error dialog when an effect of the loaded editor throws', async () => {
		vi.doMock(
			'./screenshot-editor/ScreenshotEditor.svelte',
			() => import('./test-fixtures/FailingScreenshotEditor.svelte')
		);
		await expectCaptureErrorRecovery();
	});

	it('mounts a fresh editor on retry after an editor effect threw', async () => {
		vi.doMock(
			'./screenshot-editor/ScreenshotEditor.svelte',
			() => import('./test-fixtures/TransientScreenshotEditor.svelte')
		);
		await expectCaptureErrorRecovery();

		button(en.support.screenshot.error.retry)!.click();

		await vi.waitFor(() =>
			expect(
				document.querySelector('[data-testid="screenshot-editor-ready"]'),
				'editor after retry'
			).not.toBeNull()
		);
		expect(document.querySelector('[role="alertdialog"]')).toBeNull();
	});
});
