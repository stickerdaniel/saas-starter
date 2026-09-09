import type { ServerLoadEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicCapabilityUsability } from '$lib/dev/features';

const { createAutumnHandlers, createServerConvexHttpClient, query } = vi.hoisted(() => ({
	createAutumnHandlers: vi.fn(),
	createServerConvexHttpClient: vi.fn(),
	query: vi.fn()
}));

vi.mock('$lib/convex/_generated/api', () => ({
	api: {
		capabilities: { getUsability: 'capabilities:getUsability' },
		users: { viewer: 'users:viewer' }
	}
}));

vi.mock('$lib/server/convex-http', () => ({
	createServerConvexHttpClient
}));

vi.mock('@stickerdaniel/convex-autumn-svelte/sveltekit/server', () => ({
	createAutumnHandlers
}));

import { SupportThreadContext } from '$lib/components/customer-support/support-thread-context.svelte.ts';
import { load as rootLayoutLoad } from '../../+layout.server';
import { load as homepageLoad } from './+page.server';

function fakeEvent(): ServerLoadEvent {
	return {
		locals: { publicAuthSnapshot: true },
		depends: vi.fn(),
		request: new Request('https://example.com/en'),
		cookies: { get: vi.fn() }
	} as unknown as ServerLoadEvent;
}

beforeEach(() => {
	vi.clearAllMocks();
	createServerConvexHttpClient.mockReturnValue({ query });
	query.mockResolvedValue({
		billing: { usable: false, reason: 'unavailable' },
		ai: { usable: true }
	});
});

describe('homepage capability load', () => {
	it('overrides the public root fallback before support becomes interactive', async () => {
		const event = fakeEvent();
		const rootData = await rootLayoutLoad(event as never);
		const pageData = (await homepageLoad(event as never)) as {
			capabilities: PublicCapabilityUsability;
		};
		const loadedData = { ...rootData, ...pageData };

		expect(loadedData).toMatchObject({
			authState: { isAuthenticated: false, hasSession: false },
			autumnState: { customer: null },
			viewer: null,
			capabilities: {
				billing: { usable: false, reason: 'unavailable' },
				ai: { usable: true }
			}
		});
		expect(query).toHaveBeenCalledOnce();
		expect(query).toHaveBeenCalledWith('capabilities:getUsability', {});
		expect(createAutumnHandlers).not.toHaveBeenCalled();
		expect(event.depends).toHaveBeenCalledWith('app:auth');
		expect(event.depends).toHaveBeenCalledWith('app:capabilities');

		const support = new SupportThreadContext(() => loadedData.capabilities.ai.usable);
		expect(support.awaitsAgentReply).toBe(true);
		support.setSending(true);
		await expect(support.sendMessage(null as never, 'Second message')).rejects.toThrow(
			'Cannot send message: waiting for AI response'
		);
	});

	it('fails closed without loading customer or viewer data', async () => {
		query.mockRejectedValue(new Error('backend unavailable'));
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const event = fakeEvent();

		await expect(homepageLoad(event as never)).resolves.toEqual({
			capabilities: {
				billing: { usable: false, reason: 'unavailable' },
				ai: { usable: false, reason: 'unavailable' }
			}
		});
		expect(query).toHaveBeenCalledOnce();
		expect(createAutumnHandlers).not.toHaveBeenCalled();
		expect(error).toHaveBeenCalledWith(
			'[auth-layout-data] Public capability lookup failed:',
			expect.any(Error)
		);
	});
});
