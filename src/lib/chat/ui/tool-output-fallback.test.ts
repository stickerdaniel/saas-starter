import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import ChatTool from './ChatTool.svelte';
import { formatToolOutput } from './tool-part-adapter';

// Vitest resolves Svelte's server entry by default; use its real client runtime for mounting.
vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('@tolgee/svelte', async () => {
	const { readable } = await import('svelte/store');
	return { getTranslate: () => ({ t: readable((key: string) => key) }) };
});
// The highlighted output chunk fails to load, as an asset removed by a deploy would.
vi.mock('./ChatToolOutput.svelte', () => {
	throw new Error('Failed to fetch dynamically imported module');
});

let component: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.unstubAllGlobals();
});

/** Mount one finished tool line with `output`, open it, and let the output import settle. */
async function openOutput(output: unknown) {
	component = mount(ChatTool, {
		target: document.body,
		props: {
			toolPart: { type: 'tool-lookup', name: 'lookup', state: 'output-available', output },
			phase: 'ran'
		}
	});
	flushSync();
	document.querySelector<HTMLButtonElement>('button[aria-expanded]')?.click();
	flushSync();
	await vi.dynamicImportSettled();
	flushSync();
	return {
		code: document.querySelector('[data-slot="code-block-content"]')?.textContent,
		copyButton: document.querySelector<HTMLButtonElement>('button[aria-label="aria.copy"]'),
		text: document.body.textContent ?? ''
	};
}

describe('tool output without its highlighter chunk', () => {
	it('still shows the output and its copy button', async () => {
		const { code, copyButton, text } = await openOutput({ forecast: 'Sunny' });
		expect(code).toBe('{\n  "forecast": "Sunny"\n}');
		expect(copyButton).not.toBeNull();
		expect(text).not.toContain('chat.tool.output_truncated');
	});

	it('shows and copies only the capped part of an oversized output', async () => {
		const writeText = vi.fn(() => Promise.resolve());
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		const output = 'x'.repeat(100_000);
		const capped = formatToolOutput(output).code;

		const { code, copyButton, text } = await openOutput(output);
		expect(code).toBe(capped);
		expect(text).toContain('chat.tool.output_truncated');
		copyButton?.click();
		expect(writeText).toHaveBeenCalledWith(capped);
	});
});
