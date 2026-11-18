import type { PostHog } from 'posthog-js';
import { describe, expect, it, vi } from 'vitest';
import { createPosthogInstance } from './posthog';

describe('createPosthogInstance', () => {
	// Surveys load extra SDK code and fetch survey definitions; the app ships none.
	it('initializes the SDK with surveys disabled', () => {
		const init = vi.fn();
		createPosthogInstance({ init } as unknown as PostHog, {
			apiKey: 'phc_test',
			apiHost: 'https://eu.i.posthog.com',
			uiHost: undefined,
			persistence: 'memory',
			beforeSend: (event) => event,
			name: 'app'
		});

		expect(init).toHaveBeenCalledExactlyOnceWith(
			'phc_test',
			expect.objectContaining({ disable_surveys: true }),
			'app'
		);
	});
});
