import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import ChatTool from './ChatTool.svelte';
import { deriveOrderedParts } from './ordered-parts';
import type { ToolPart, ToolPhase } from './tool-part-adapter';

// Vitest resolves Svelte's server entry by default; use its real client runtime for mounting.
vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('@tolgee/svelte', async () => {
	const { readable } = await import('svelte/store');
	return {
		getTranslate: () => ({
			t: readable((key: string) => (key === 'common.error' ? 'Safe localized failure' : key))
		})
	};
});

let component: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	document.body.replaceChildren();
});

/** Mount one tool line, open it the way a reader does, and return what it shows. */
async function openTool(toolPart: ToolPart, phase: ToolPhase) {
	component = mount(ChatTool, { target: document.body, props: { toolPart, phase } });
	flushSync();
	const trigger = document.querySelector<HTMLButtonElement>('button[aria-expanded]');
	if (!trigger) throw new Error('Expected a trace trigger');
	trigger.click();
	flushSync();
	expect(trigger.getAttribute('aria-expanded')).toBe('true');
	// The output block is loaded on open.
	await vi.dynamicImportSettled();
	flushSync();
	return {
		text: document.body.textContent ?? '',
		copyButton: document.querySelector('button[aria-label="aria.copy"]')
	};
}

describe('tool failure rendering', () => {
	it.each(['success', 'streaming'] as const)(
		'renders fixed localized copy through the %s message path',
		async (status) => {
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
			const { text, copyButton } = await openTool(item.toolPart, item.phase);
			expect(text).toContain('chat.tool.failed');
			expect(text).toContain('Safe localized failure');
			expect(text).not.toContain(rawError);
			expect(copyButton).toBeNull();
		}
	);

	it('shows no output a direct caller hands it for a failed call', async () => {
		const { text, copyButton } = await openTool(
			{
				type: 'tool-weather',
				name: 'weather',
				state: 'output-error',
				output: { error: 'PRIVATE_OUTPUT_DIAGNOSTIC' }
			},
			'failed'
		);
		expect(text).toContain('Safe localized failure');
		expect(text).not.toContain('PRIVATE_');
		expect(copyButton).toBeNull();
	});

	it('keeps successful error-shaped tool output visible without a failure description', async () => {
		const { text, copyButton } = await openTool(
			{
				type: 'tool-weather',
				name: 'weather',
				state: 'output-available',
				output: { type: 'error-json', value: { forecast: 'Sunny' } }
			},
			'ran'
		);
		expect(text).toContain('Sunny');
		expect(text).not.toContain('Safe localized failure');
		expect(copyButton).not.toBeNull();
	});
});
