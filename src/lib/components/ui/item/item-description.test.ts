import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve('src/lib/components/ui/item/item-description.svelte'), 'utf8');

describe('Item.Description', () => {
	it('does not hide overflowing copy by default', () => {
		// Info cards are not interactive, so truncated copy has no way to be revealed.
		expect(source).not.toMatch(/\b(?:line-clamp-\S+|truncate|overflow-hidden)\b/);
	});
});
