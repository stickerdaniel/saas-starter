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
	it('preserves the visible thread list while loading more', () => {
		const source = fs.readFileSync(appLayoutPath, 'utf8');

		expect(source).toContain('api.aiChat.threads.listThreads');
		// Keep the initial query small without clearing the existing DOM while the
		// next page loads, so AutoAnimate observes the appended thread rows.
		expect(source).toContain('let threadListLimit = $state(10)');
		expect(source).toMatch(/listThreads,[\s\S]*limit:\s*threadListLimit/);
		expect(source).not.toMatch(/listThreads,[\s\S]*limit:\s*50/);
		expect(source).toContain('threadsQuery.data?.hasMore');
		expect(source).toMatch(
			/listThreads,[\s\S]*limit:\s*threadListLimit[\s\S]*keepPreviousData:\s*true/
		);
	});

	it('drives the sidebar Show more from the backend hasMore, not a client slice', () => {
		const source = fs.readFileSync(threadListPath, 'utf8');

		expect(source).not.toContain('displayLimit');
		expect(source).toContain('let { items, hasMore, onShowMore }');
	});

	it('prewarms the normal AI Chat navigation path', () => {
		const layout = fs.readFileSync(appLayoutPath, 'utf8');
		const sidebar = fs.readFileSync(sidebarConfigPath, 'utf8');

		expect(layout).toContain('api.aiChat.threads.getWarmThread');
		expect(layout).toContain('api.aiChat.threads.getOrCreateWarmThread');
		expect(layout).toContain('`/app/ai-chat?thread=${warmThreadId}`');
		expect(sidebar).toContain('warmThreadId?: string | null');
		expect(sidebar).toContain('url: aiChatUrl');
		expect(sidebar).toContain('activeThreadId === warmThreadId');
	});

	it('disables unused PostHog survey code', () => {
		const source = fs.readFileSync(posthogPath, 'utf8');

		expect(source).toMatch(/posthog\.init\([\s\S]*disable_surveys:\s*true/);
	});
});
