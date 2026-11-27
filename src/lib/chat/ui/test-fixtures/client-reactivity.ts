import { vi } from 'vitest';
import type * as SvelteReactivity from 'svelte/reactivity';

/**
 * `svelte/reactivity` for suites that mount through Svelte's client runtime.
 * Vitest resolves the server entry, whose SvelteMap is a plain Map that no
 * effect follows. The rest stays the server one: jsdom has no `matchMedia`
 * for MediaQuery, and runed's stores keep the subscriber these suites were
 * written against.
 */
const client = await vi.importActual<typeof SvelteReactivity>(
	'../../../../../node_modules/svelte/src/reactivity/index-client.js'
);
const server = await vi.importActual<typeof SvelteReactivity>(
	'../../../../../node_modules/svelte/src/reactivity/index-server.js'
);

export const { SvelteMap, SvelteSet } = client;
export const { SvelteDate, SvelteURL, SvelteURLSearchParams, MediaQuery, createSubscriber } =
	server;
