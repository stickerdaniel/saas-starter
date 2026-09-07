import { beforeEach, describe, expect, it, vi } from 'vitest';

const { init } = vi.hoisted(() => ({ init: vi.fn() }));

vi.mock('$env/static/public', () => ({
	PUBLIC_POSTHOG_API_KEY: 'ph_test',
	PUBLIC_POSTHOG_HOST: 'https://eu.i.posthog.com',
	PUBLIC_POSTHOG_PROXY_HOST: ''
}));

vi.mock('posthog-js', () => ({ default: { init } }));
vi.mock('$lib/dev/notice', () => ({ devNotice: vi.fn() }));

describe('initPosthog', () => {
	beforeEach(() => {
		vi.resetModules();
		init.mockReset();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response()));
	});

	it('disables extensions that persist data or inject remote UI', async () => {
		const { initPosthog } = await import('./posthog');

		await initPosthog();

		expect(init).toHaveBeenCalledWith(
			'ph_test',
			expect.objectContaining({
				disable_conversations: true,
				disable_product_tours: true,
				disable_surveys: true,
				persistence: 'memory'
			})
		);
	});
});
