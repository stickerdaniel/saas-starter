import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderDeskComputerSvg } from './desk-computer/figure';
import { DESK_COMPUTER_SVG } from './generate-desk-computer';

describe('committed desk computer figure', () => {
	it('is what scripts/desk-computer/ renders', () => {
		expect(
			readFileSync(DESK_COMPUTER_SVG, 'utf-8') === renderDeskComputerSvg(),
			'Run `bun run generate:desk-computer` and commit the result'
		).toBe(true);
	});
});
