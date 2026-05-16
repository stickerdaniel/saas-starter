import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetDevNoticeDedupeForTests, devNotice } from './notice';

describe('devNotice', () => {
	const originalLocalConvexDev = process.env.LOCAL_CONVEX_DEV;
	let warnSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		_resetDevNoticeDedupeForTests();
		warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		warnSpy.mockRestore();
		if (originalLocalConvexDev === undefined) {
			delete (process.env as Record<string, string | undefined>).LOCAL_CONVEX_DEV;
		} else {
			process.env.LOCAL_CONVEX_DEV = originalLocalConvexDev;
		}
	});

	it('logs a structured warning for a Convex feature in local dev', () => {
		process.env.LOCAL_CONVEX_DEV = 'true';
		devNotice({
			feature: 'GitHub sign-in',
			missing: ['AUTH_GITHUB_ID', 'AUTH_GITHUB_SECRET'],
			scope: 'convex'
		});
		expect(warnSpy).toHaveBeenCalledOnce();
		const [message] = warnSpy.mock.calls[0]!;
		expect(message).toMatch(
			/GitHub sign-in disabled\. Missing: AUTH_GITHUB_ID, AUTH_GITHUB_SECRET/
		);
		expect(message).toMatch(/bunx convex env set AUTH_GITHUB_ID <value>/);
		expect(message).toMatch(/bunx convex env set AUTH_GITHUB_SECRET <value>/);
		expect(message).toMatch(/See: \.env\.convex\.example/);
	});

	it('logs a vite-public feature with the .env.local fix hint', () => {
		// Vite test runner exposes import.meta.env.DEV by default.
		devNotice({
			feature: 'Product analytics (PostHog)',
			missing: ['PUBLIC_POSTHOG_API_KEY', 'PUBLIC_POSTHOG_HOST'],
			scope: 'vite-public'
		});
		expect(warnSpy).toHaveBeenCalledOnce();
		const [message] = warnSpy.mock.calls[0]!;
		expect(message).toMatch(/add PUBLIC_POSTHOG_API_KEY=<value> to \.env\.local/);
		expect(message).toMatch(/See: \.env\.schema/);
	});

	it('dedupes identical notices within the process', () => {
		process.env.LOCAL_CONVEX_DEV = 'true';
		const payload = {
			feature: 'GitHub sign-in',
			missing: ['AUTH_GITHUB_ID'],
			scope: 'convex'
		} as const;
		devNotice(payload);
		devNotice(payload);
		devNotice(payload);
		expect(warnSpy).toHaveBeenCalledOnce();
	});

	it('is a no-op when LOCAL_CONVEX_DEV is unset for convex scope', () => {
		delete (process.env as Record<string, string | undefined>).LOCAL_CONVEX_DEV;
		devNotice({
			feature: 'GitHub sign-in',
			missing: ['AUTH_GITHUB_ID'],
			scope: 'convex'
		});
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it('is a no-op when the missing list is empty', () => {
		process.env.LOCAL_CONVEX_DEV = 'true';
		devNotice({
			feature: 'Email delivery',
			missing: [],
			scope: 'convex'
		});
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it('honors a custom docs path', () => {
		process.env.LOCAL_CONVEX_DEV = 'true';
		devNotice({
			feature: 'Custom',
			missing: ['FOO'],
			scope: 'convex',
			docs: 'docs/setup.md'
		});
		const [message] = warnSpy.mock.calls[0]!;
		expect(message).toMatch(/See: docs\/setup\.md/);
	});
});
