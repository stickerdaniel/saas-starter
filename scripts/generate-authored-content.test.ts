import { describe, expect, it } from 'vitest';
import { renderGeneratedSupportInstructions } from './generate-authored-content';

describe('renderGeneratedSupportInstructions', () => {
	it('normalizes line endings and safely serializes prompt syntax', () => {
		const generated = renderGeneratedSupportInstructions('Use `code` and ${value}.\r\n');

		expect(generated).toContain('export const SUPPORT_AGENT_INSTRUCTIONS_TEMPLATE = ');
		expect(generated).toContain('Use `code` and ${value}.');
		expect(generated).not.toContain('\r');
	});
});
