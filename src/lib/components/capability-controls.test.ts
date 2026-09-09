import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
	return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('browser capability controls', () => {
	it('gates billing operations through the public projection', () => {
		const provider = source('src/lib/components/billing/checkout-provider.svelte');
		const checkout = source('src/lib/components/billing/checkout-context.svelte.ts');
		const pricing = source('src/blocks/pricing/pricing-three.svelte');
		const navigation = source('src/lib/components/nav-user.svelte');
		expect(provider).toContain('page.data.capabilities?.billing.usable === true');
		expect(checkout).toContain('if (!this.isUsable)');
		expect(checkout).toContain('this.#deps.onUnavailable()');
		expect(pricing).toContain('disabled={!billingUsable || billingCheckout.isLoading}');
		expect(navigation).toContain('disabled={!billingUsable || portalOperation.isLoading}');
	});

	it('does not offer AI chat work when AI or its billing gate is unavailable', () => {
		const aiPage = source('src/routes/[[lang]]/app/ai-chat/+page.svelte');
		expect(aiPage).toContain('data.capabilities?.billing.usable === true');
		expect(aiPage).toContain('data.capabilities?.ai.usable === true');
		expect(aiPage).toContain('viewer.data && aiChatUsable');
		expect(aiPage).toContain('{#if !aiChatUsable}');
	});

	it('uses human-only support and hides the AI launcher when AI is unavailable', () => {
		const support = source('src/lib/components/customer-support/customer-support.svelte');
		const context = source('src/lib/components/customer-support/support-thread-context.svelte.ts');
		expect(support).toContain('page.data.capabilities?.ai.usable === true');
		expect(support).toContain('{#if isSupportAiEnabled() && aiUsable}');
		expect(context).toContain('isSupportAiEnabled() && this.isAiUsable()');
	});
});
