import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
	return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('browser diagnostics', () => {
	it('keeps provider, backend, and user errors out of console callbacks', () => {
		const aiPage = source('src/routes/[[lang]]/app/ai-chat/+page.svelte');
		const checkout = source('src/lib/components/billing/checkout-provider.svelte');
		const migration = source(
			'src/lib/components/customer-support/support-ticket-migration-bootstrap.svelte'
		);
		const screenshot = source(
			'src/lib/components/customer-support/screenshot-editor/ScreenshotEditor.svelte'
		);
		const adminSupport = source('src/routes/[[lang]]/admin/support/thread-chat.svelte');
		const feedback = source('src/lib/components/customer-support/feedback-widget.svelte');
		const customerSupport = source('src/lib/components/customer-support/customer-support.svelte');
		const screenshotContext = source(
			'src/lib/components/customer-support/screenshot-editor/screenshot-editor-context.svelte.ts'
		);

		expect(aiPage).toMatch(/console\.error\(\s*'\[AIChat\.resolveWarmThread\] Failed'\s*\)/);
		expect(aiPage).not.toMatch(/console\.error\([^)]*,\s*err\s*\)/);
		expect(checkout).toMatch(/onError: \(stage\) =>/);
		expect(checkout).toContain("'[BillingCheckout.confirm] Failed'");
		expect(checkout).toContain("'[BillingCheckout.start] Failed'");
		expect(checkout).not.toMatch(/console\.error\([^)]*,\s*error\s*\)/);
		expect(migration).toMatch(
			/console\.error\(\s*'\[SupportMigration\.migrateAnonymousTickets\] Failed'\s*\)/
		);
		expect(migration).not.toMatch(/onMigrationError\([^)]/);
		expect(screenshot).toMatch(/console\.error\(\s*'\[ScreenshotEditor\.capture\] Failed'\s*\)/);
		expect(screenshot).toContain('onCaptureError?.(error)');
		expect(screenshot).not.toMatch(/console\.error\([^)]*,\s*error\s*\)/);
		expect(adminSupport).toMatch(/console\.error\(\s*'\[AdminSupport\.sendReply\] Failed'\s*\)/);
		expect(adminSupport).not.toMatch(/console\.error\([^)]*,\s*error\s*\)/);
		expect(feedback).toMatch(/console\.warn\(\s*'\[FeedbackWidget\.markReplyRead\] Failed'\s*\)/);
		expect(feedback).not.toMatch(/console\.warn\([^)]*,\s*error\s*\)/);
		expect(customerSupport).toMatch(
			/console\.warn\(\s*'\[CustomerSupport\.resolveThreadUrl\] Invalid'\s*\)/
		);
		expect(customerSupport).not.toMatch(/console\.warn\([^)]*,\s*error\s*\)/);
		expect(screenshotContext).toMatch(
			/console\.warn\(\s*'\[ScreenshotEditor\.preCache\] Failed'\s*\)/
		);
		expect(screenshotContext).not.toMatch(/console\.warn\([^)]*,\s*error\s*\)/);
	});
});

describe('browser capability controls', () => {
	it('gates billing operations through the public projection', () => {
		const provider = source('src/lib/components/billing/checkout-provider.svelte');
		const checkout = source('src/lib/components/billing/checkout-context.svelte.ts');
		const pricing = source('src/blocks/pricing/pricing-three.svelte');
		const navigation = source('src/lib/components/nav-user.svelte');
		expect(provider).toContain('page.data.capabilities?.billing.usable === true');
		expect(provider).toContain('page.data.localE2E?.billing === true');
		expect(checkout).toContain('if (!this.isUsable)');
		expect(checkout).toContain('this.#deps.onUnavailable()');
		expect(pricing).toContain('disabled={!billingUsable || billingCheckout.isLoading}');
		expect(navigation).toContain('disabled={!billingUsable || portalOperation.isLoading}');
	});

	it('does not offer AI chat work when AI or its billing gate is unavailable', () => {
		const aiPage = source('src/routes/[[lang]]/app/ai-chat/+page.svelte');
		expect(aiPage).toContain('data.capabilities?.billing.usable === true');
		expect(aiPage).toContain('data.capabilities?.ai.usable === true');
		expect(aiPage).toContain('data.localE2E?.aiChat === true');
		expect(aiPage).toContain('(billingUsable && aiUsable) || localE2EAiChat');
		expect(aiPage).toContain('viewer.data && aiChatUsable');
		expect(aiPage).toContain('{#if !aiChatUsable}');
	});

	it('uses human-only support and hides the AI launcher when AI is unavailable', () => {
		const support = source('src/lib/components/customer-support/customer-support.svelte');
		const conversation = source(
			'src/lib/components/customer-support/support-conversation.svelte.ts'
		);
		expect(support).toContain('const capabilityQuery = useQuery(');
		expect(support).toContain('api.capabilities.getUsability,');
		expect(support).toContain('capabilityQuery.data?.ai.usable === true');
		expect(support).toContain('disabled={!capabilitiesResolved}');
		expect(support).toContain('{#if isSupportAiEnabled() && aiUsable}');
		expect(conversation).toContain('isSupportAiEnabled() && this.isAiUsable()');
	});
});
