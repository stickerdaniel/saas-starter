import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve('src/lib/components/ui/item/item.svelte'), 'utf8');

describe('Item.Root', () => {
	it('stacks muted information cards on narrow screens', () => {
		const mutedVariant = source.match(/muted:\s*'([^']+)'/)?.[1];

		expect(mutedVariant).toContain('max-sm:flex-col');
		expect(mutedVariant).toContain('max-sm:items-stretch');
	});
});
