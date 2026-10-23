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
			t: readable((key: string) => key)
		})
	};
});

let component: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	document.body.replaceChildren();
});

/** Mount one tool line, open it the way a reader does if it opens, and return its text. */
function renderTool(toolPart: ToolPart, phase: ToolPhase) {
	component = mount(ChatTool, { target: document.body, props: { toolPart, phase } });
	flushSync();
	const trigger = document.querySelector<HTMLButtonElement>('button[aria-expanded]');
	trigger?.click();
	flushSync();
	return { text: document.body.textContent ?? '', opens: trigger !== null };
}

describe('tool failure rendering', () => {
	it.each(['success', 'streaming'] as const)(
		'shows only the localized title through the %s message path',
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
			const { text, opens } = renderTool(item.toolPart, item.phase);
			expect(text.trim()).toBe('chat.tool.failed');
			expect(opens).toBe(false);
		}
	);

	it('shows no output a direct caller hands it for a failed call', () => {
		const { text, opens } = renderTool(
			{
				type: 'tool-weather',
				name: 'weather',
				state: 'output-error',
				output: { error: 'PRIVATE_OUTPUT_DIAGNOSTIC' }
			},
			'failed'
		);
		expect(text.trim()).toBe('chat.tool.failed');
		expect(opens).toBe(false);
	});

	it('opens successful error-shaped tool output as JSON', () => {
		const { text, opens } = renderTool(
			{
				type: 'tool-weather',
				name: 'weather',
				state: 'output-available',
				output: { type: 'error-json', value: { forecast: 'Sunny' } }
			},
			'ran'
		);
		expect(opens).toBe(true);
		expect(text).toContain('"forecast": "Sunny"');
	});

	it('opens text output as written', () => {
		const { text } = renderTool(
			{ type: 'tool-weather', name: 'weather', state: 'output-available', output: 'Sunny\n21 °C' },
			'ran'
		);
		expect(text).toContain('Sunny\n21 °C');
	});
});
