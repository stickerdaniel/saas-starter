import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const appLayoutPath = path.resolve('src/routes/[[lang]]/app/+layout.svelte');
const sidebarConfigPath = path.resolve(
	'src/lib/components/authenticated/configs/app-sidebar-config.ts'
);
const posthogPath = path.resolve('src/lib/analytics/posthog.ts');
const threadListPath = path.resolve('src/lib/components/authenticated/sidebar-thread-list.svelte');

describe('app shell performance invariants', () => {
	it('loads only the initially visible AI chat threads', () => {
		const source = fs.readFileSync(appLayoutPath, 'utf8');

		expect(source).toContain('api.aiChat.threads.listThreads');
		// Initial page of 10, growable via the query so "Show more" reflects the
		// real backend count instead of a client-only slice.
		expect(source).toContain('let threadListLimit = $state(10)');
		expect(source).toMatch(/listThreads,[\s\S]*limit:\s*threadListLimit/);
		expect(source).not.toMatch(/listThreads,[\s\S]*limit:\s*50/);
		expect(source).toContain('threadsQuery.data?.hasMore');
	});

	it('drives the sidebar Show more from the backend hasMore, not a client slice', () => {
		const source = fs.readFileSync(threadListPath, 'utf8');

		expect(source).not.toContain('displayLimit');
		expect(source).toContain('let { items, hasMore, onShowMore }');
	});

	it('defers warm-thread lookup and creation to the AI chat route', () => {
		const layout = fs.readFileSync(appLayoutPath, 'utf8');
		const sidebar = fs.readFileSync(sidebarConfigPath, 'utf8');

		expect(layout).not.toContain('getWarmThread');
		expect(layout).not.toContain('getOrCreateWarmThread');
		expect(layout).toContain("Digit2: localizedHref('/app/ai-chat')");
		expect(sidebar).toContain("url: localizedHref('/app/ai-chat')");
		expect(sidebar).not.toContain('warmThreadId');
	});

	it('disables unused PostHog survey code', () => {
		const source = fs.readFileSync(posthogPath, 'utf8');

		expect(source).toMatch(/posthog\.init\([\s\S]*disable_surveys:\s*true/);
	});
});
