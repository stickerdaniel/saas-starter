/**
 * Admin support renders one thread view per thread id, so a thread switch
 * unmounts the view that started an upload (issue #765). Its unfinished
 * transfer ends with it and stops holding up navigation.
 */

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { ConvexClient } from 'convex/browser';
import type * as FileUploader from '#lib/chat/core/file-uploader.js';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('svelte/reactivity', () => import('#lib/chat/ui/test-fixtures/client-reactivity.ts'));
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('#lib/chat/ui/ChatMessages.svelte', () => ({ default: () => {} }));
vi.mock('#lib/chat/ui/ChatAttachments.svelte', async () => ({
	default: (await import('#lib/chat/ui/test-fixtures/CapturedChatAttachments.svelte')).default
}));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('$app/state', () => ({ page: { data: { lang: 'en' } } }));
vi.mock('#lib/auth-client.js', () => ({
	authClient: { useSession: () => ({ subscribe: () => () => {} }) }
}));
vi.mock('#lib/hooks/use-media.svelte.ts', () => ({
	useMedia: () => ({ sm: false, lg: false, xl: false })
}));
vi.mock('#lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));
const transfers = vi.hoisted(() => [] as AbortSignal[]);
vi.mock('#lib/chat/core/file-uploader.js', async (importOriginal) => ({
	...(await importOriginal<typeof FileUploader>()),
	uploadFileWithProgress: (
		_blob: Blob,
		_filename: string,
		_onProgress: unknown,
		_config: unknown,
		_dimensions: unknown,
		signal: AbortSignal
	) => {
		transfers.push(signal);
		return new Promise(() => {});
	}
}));

import ChatTestProvider from '#lib/chat/ui/test-fixtures/ChatTestProvider.svelte';
import KeyedAdminThreadLifecycleHarness, {
	keyedAdminThreadLifecycle
} from '#lib/chat/ui/test-fixtures/KeyedAdminThreadLifecycleHarness.svelte';
import { capturedAttachments } from '#lib/chat/ui/test-fixtures/CapturedChatAttachments.svelte';

let component: ReturnType<typeof mount> | undefined;
let client: ConvexClient;

beforeEach(() => {
	client = new ConvexClient('https://chat-test.convex.cloud', { disabled: true });
	localStorage.clear();
	transfers.length = 0;
	vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/attachment');
	vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	capturedAttachments.props = undefined;
	await client.close();
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

function pick(file: File) {
	const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
	Object.defineProperty(input, 'files', { value: [file], configurable: true });
	input.dispatchEvent(new Event('change', { bubbles: true }));
}

it('cancels an unfinished upload and lets navigation go when the admin switches threads', async () => {
	const contentProps = { initialThreadId: 'thread-a' };
	component = mount(ChatTestProvider<typeof contentProps>, {
		target: document.body,
		props: { client, content: KeyedAdminThreadLifecycleHarness, contentProps }
	});
	await tick();
	const activeUploads = keyedAdminThreadLifecycle.activeUploads!;
	pick(new File(['notes'], 'notes.txt', { type: 'text/plain' }));
	await vi.waitFor(() => expect(transfers).toHaveLength(1));
	expect(activeUploads.any).toBe(true);
	await tick();
	expect(capturedAttachments.props?.attachments).toMatchObject([{ name: 'notes.txt' }]);

	flushSync(() => keyedAdminThreadLifecycle.setThreadId?.('thread-b'));
	await tick();

	expect(transfers[0]!.aborted).toBe(true);
	expect(activeUploads.any).toBe(false);
	capturedAttachments.props = undefined;
	flushSync(() => keyedAdminThreadLifecycle.setThreadId?.('thread-a'));
	await tick();
	expect(capturedAttachments.props).toBeUndefined();
	expect(document.querySelector('textarea')).not.toBeNull();
});
