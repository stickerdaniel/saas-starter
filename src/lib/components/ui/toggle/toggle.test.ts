import { describe, expect, it } from 'vitest';
import { cn } from '#lib/utils.js';
import { toggleVariants } from './toggle.svelte';

describe('toggleVariants', () => {
	it.each(['transition-all', 'transition-colors'])(
		'lets a caller %s replace the field lane',
		(transition) => {
			const classes = cn(toggleVariants(), transition).split(' ');

			expect(classes).toContain(transition);
			expect(classes).not.toContain('transition-field-colors');
		}
	);
});
