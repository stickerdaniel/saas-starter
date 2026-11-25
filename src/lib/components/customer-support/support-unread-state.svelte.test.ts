import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import type * as SvelteReactivity from 'svelte/reactivity';
import { ConvexClient } from 'convex/browser';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('svelte/reactivity', () =>
	vi.importActual<typeof SvelteReactivity>(
		'../../../../node_modules/svelte/src/reactivity/index-client.js'
	)
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true, NODE: false }));

import SupportUnreadCount from './test-fixtures/SupportUnreadCount.svelte';
import { clearSupportUserId, supportUserId } from './support-user-id.svelte.ts';

type QueryAdd = { type: 'Add'; queryId: number; udfPath: string; args: unknown[] };
type QueryChange = QueryAdd | { type: 'Remove'; queryId: number };
type ClientMessage =
	| { type: 'ModifyQuerySet'; newVersion: number; modifications: QueryChange[] }
	| { type: 'Connect' | 'Authenticate' | 'Mutation' | 'Action' | 'Event' };

const encodeTs = (ts: number) => btoa(String.fromCharCode(ts, 0, 0, 0, 0, 0, 0, 0));

class ScriptedSocket {
	static current: ScriptedSocket | undefined;
	onopen?: () => void;
	onmessage?: (message: { data: string }) => void;
	onclose?: (event: { code: number; reason: string }) => void;
	onerror?: (error: unknown) => void;
	readonly added: QueryAdd[] = [];
	#sentQuerySet = 0;
	#answeredQuerySet = 0;
	#ts = 0;

	constructor() {
		ScriptedSocket.current = this;
		queueMicrotask(() => this.onopen?.());
	}

	send(raw: string) {
		const message = JSON.parse(raw) as ClientMessage;
		if (message.type !== 'ModifyQuerySet') return;
		this.#sentQuerySet = message.newVersion;
		this.added.push(...message.modifications.filter((change) => change.type === 'Add'));
	}

	close() {
		queueMicrotask(() => this.onclose?.({ code: 1000, reason: '' }));
	}

	answerLatest(value: number) {
		const query = this.added.at(-1);
		if (!query) throw new Error('No query subscribed');
		this.onmessage?.({
			data: JSON.stringify({
				type: 'Transition',
				startVersion: { querySet: this.#answeredQuerySet, identity: 0, ts: encodeTs(this.#ts) },
				endVersion: { querySet: this.#sentQuerySet, identity: 0, ts: encodeTs(++this.#ts) },
				modifications: [
					{ type: 'QueryUpdated', queryId: query.queryId, value, logLines: [], journal: null }
				]
			})
		});
		this.#answeredQuerySet = this.#sentQuerySet;
	}
}

let client: ConvexClient | undefined;
let component: ReturnType<typeof mount> | undefined;

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	await client?.close();
	client = undefined;
	ScriptedSocket.current = undefined;
	localStorage.clear();
	document.body.replaceChildren();
});

describe('useSupportUnreadState', () => {
	it('keeps the count when sign-in drops the anonymous id and the answer repeats', async () => {
		supportUserId.current = 'anon_visitor';
		client = new ConvexClient('https://support-unread-test.convex.cloud', {
			webSocketConstructor: ScriptedSocket as unknown as typeof WebSocket,
			unsavedChangesWarning: false
		});
		component = mount(SupportUnreadCount, { target: document.body, props: { client } });
		flushSync();
		const socket = await vi.waitFor(() => {
			const current = ScriptedSocket.current;
			if (current?.added.length !== 1) throw new Error('The query is not subscribed yet');
			return current;
		});
		const count = () => document.querySelector('output')?.textContent;

		socket.answerLatest(1);
		flushSync();
		expect(count()).toBe('1');

		clearSupportUserId();
		flushSync();
		expect(socket.added.map((query) => query.args)).toEqual([
			[{ anonymousUserId: 'anon_visitor' }],
			[{}]
		]);

		socket.answerLatest(1);
		flushSync();
		expect(count()).toBe('1');
	});
});
