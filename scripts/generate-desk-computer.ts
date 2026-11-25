/**
 * Generate the landing page desk computer figure from scripts/desk-computer/.
 *
 * The output is committed. After changing the geometry, run
 * `bun run generate:desk-computer` and commit the result; generate-desk-computer.test.ts
 * fails while the committed file differs from what the generator renders.
 *
 * Usage: bun scripts/generate-desk-computer.ts
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderDeskComputerSvg } from './desk-computer/figure';

export const DESK_COMPUTER_SVG = join(
	import.meta.dirname,
	'../src/lib/components/desk-computer/desk-computer.svg'
);

if (import.meta.main) {
	writeFileSync(DESK_COMPUTER_SVG, renderDeskComputerSvg());
	console.log('Generated src/lib/components/desk-computer/desk-computer.svg');
}
