import { describe, expect, it, vi } from 'vitest';
import {
	initializeAuthoredContentWatcher,
	renderGeneratedSupportInstructions
} from './generate-authored-content';

describe('initializeAuthoredContentWatcher', () => {
	it('registers the watcher before the initial generation', () => {
		const order: string[] = [];
		const watcher = { close: vi.fn() };

		expect(
			initializeAuthoredContentWatcher(
				() => {
					order.push('watch');
					return watcher;
				},
				() => order.push('generate')
			)
		).toBe(watcher);
		expect(order).toEqual(['watch', 'generate']);
	});

	it('closes the watcher when initial generation fails', () => {
		const watcher = { close: vi.fn() };
		expect(() =>
			initializeAuthoredContentWatcher(
				() => watcher,
				() => {
					throw new Error('generation failed');
				}
			)
		).toThrow('generation failed');
		expect(watcher.close).toHaveBeenCalledOnce();
	});
});

describe('renderGeneratedSupportInstructions', () => {
	it('normalizes line endings and safely serializes prompt syntax', () => {
		const generated = renderGeneratedSupportInstructions('Use `code` and ${value}.\r\n');

		expect(generated).toContain('export const SUPPORT_AGENT_INSTRUCTIONS_TEMPLATE = ');
		expect(generated).toContain('Use `code` and ${value}.');
		expect(generated).not.toContain('\r');
	});
});
