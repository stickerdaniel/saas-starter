// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import ToolDetails from '$lib/components/prompt-kit/tool/ToolDetails.svelte';
import { deriveOrderedParts } from './ordered-parts';

vi.mock('@tolgee/svelte', async () => {
	const { readable } = await import('svelte/store');
	return {
		getTranslate: () => ({
			t: readable((key: string) => (key === 'common.error' ? 'Safe localized failure' : key))
		})
	};
});

describe('tool failure rendering', () => {
	it.each(['success', 'streaming'] as const)(
		'renders fixed localized copy through the %s message path',
		(status) => {
			const rawError = 'PRIVATE_PROVIDER_DIAGNOSTIC';
			const item = deriveOrderedParts(
				[
					{
						type: 'tool-weather',
						state: 'output-error',
						toolCallId: 'call-1',
						errorText: rawError,
						output: { error: rawError }
					}
				],
				status
			)[0];
			if (item?.kind !== 'tool') throw new Error('Expected a renderable tool part');
			const html = render(ToolDetails, { props: { toolPart: item.toolPart } }).body;
			expect(html).toContain('Safe localized failure');
			expect(html).not.toContain(rawError);
		}
	);

	it.each([undefined, '', 'PRIVATE_PROVIDER_DIAGNOSTIC'])(
		'protects direct callers and failed calls with errorText %j',
		(errorText) => {
			const html = render(ToolDetails, {
				props: {
					toolPart: {
						type: 'tool-weather',
						state: 'output-error',
						errorText,
						output: { error: 'PRIVATE_OUTPUT_DIAGNOSTIC' }
					}
				}
			}).body;
			expect(html).toContain('Safe localized failure');
			expect(html).not.toContain('PRIVATE_');
		}
	);

	it('keeps successful tool output visible without a failure description', () => {
		const html = render(ToolDetails, {
			props: {
				toolPart: {
					type: 'tool-weather',
					state: 'output-available',
					output: { forecast: 'Sunny' }
				}
			}
		}).body;
		expect(html).toContain('Sunny');
		expect(html).not.toContain('Safe localized failure');
	});
});
