import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

const NOW = new Date(2026, 10, 27, 15, 30).getTime();
const DAY = 86_400_000;
const MCP_URL = 'https://deployment.example.test/mcp';

const convex = vi.hoisted(() => ({
	connections: [] as unknown[],
	endpoint: undefined as { url: string } | undefined
}));

vi.mock('convex-svelte', () => ({
	useConvexClient: () => ({ mutation: vi.fn() }),
	usePaginatedQuery: () => ({
		get results() {
			return convex.connections;
		},
		status: 'Exhausted',
		loadMore: vi.fn()
	}),
	useQuery: () => ({
		get data() {
			return convex.endpoint;
		}
	})
}));
vi.mock('#lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));
vi.mock('$app/state', () => ({ page: { data: { lang: 'en' } } }));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn() } }));

import ConnectedAppsSettingsHarness from './test-fixtures/ConnectedAppsSettingsHarness.svelte';

let component: ReturnType<typeof mount> | undefined;

const connection = (clientName: string, lastUsedAt: number | null) => ({
	consentId: `consent-${clientName}`,
	clientId: `client-${clientName}`,
	clientName,
	scopes: ['mcp:read'],
	connectedAt: NOW - 10 * DAY,
	lastUsedAt
});

async function render() {
	component = mount(ConnectedAppsSettingsHarness, { target: document.body });
	await tick();
	await vi.waitFor(() => expect(document.querySelector('input')).not.toBeNull());
}

const cells = (clientName: string) => {
	const block = Array.from(document.querySelectorAll('li')).find(
		(item) => item.querySelector('span')?.textContent?.trim() === clientName
	);
	if (!block) throw new Error(`No block for ${clientName}`);
	return Object.fromEntries(
		Array.from(block.querySelectorAll('dl > div')).map((cell) => [
			cell.querySelector('dt')?.textContent?.trim(),
			cell.querySelector('dd')?.textContent?.trim()
		])
	);
};

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'], now: NOW });
	convex.connections = [];
	convex.endpoint = undefined;
});

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	document.body.innerHTML = '';
	vi.useRealTimers();
});

describe('connected apps settings', () => {
	it('shows the last use of each connection in days', async () => {
		convex.connections = [
			connection('Unused app', null),
			connection('Current app', NOW - 60_000),
			connection('Earlier app', NOW - 3 * DAY)
		];
		await render();
		expect(cells('Unused app')['Last used']).toBe('Never');
		expect(cells('Current app')['Last used']).toBe('today');
		expect(cells('Earlier app')['Last used']).toBe('3 days ago');
	});

	it('shows the MCP URL the backend returns', async () => {
		convex.endpoint = { url: MCP_URL };
		await render();
		const input = document.querySelector('input');
		expect(input?.value).toBe(MCP_URL);
		expect(input?.readOnly).toBe(true);
		const label = document.getElementById(input?.getAttribute('aria-labelledby') ?? '');
		expect(label?.textContent?.trim()).toBe('Connect an app');
	});
});
