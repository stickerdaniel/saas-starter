import { vi } from 'vitest';
import type * as Svelte from 'svelte';
import {
	describeChatInputOptions,
	setupChatInputOptions
} from './test-fixtures/chat-input-options-suite.js';

// Vitest resolves Svelte's server entry by default; use its real client runtime for mounting.
vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('#lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));
vi.mock('./ChatAttachments.svelte', () => ({ default: () => {} }));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('#lib/media/process-image.js', () => ({ processImage: vi.fn() }));

describeChatInputOptions(setupChatInputOptions(), 'admin support');
