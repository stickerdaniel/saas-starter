import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type * as Svelte from 'svelte';
import { vi } from 'vitest';

const svelteManifest = createRequire(import.meta.url).resolve('svelte/package.json');

export const importSvelteClient = () =>
	vi.importActual<typeof Svelte>(join(dirname(svelteManifest), 'src/index-client.js'));
