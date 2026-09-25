import { describe, expect, it } from 'vitest';
import { toggleVariants } from './toggle.svelte';

describe('toggleVariants', () => {
	it.each(['transition-all', 'transition-colors'])(
		'lets a caller %s passed to the helper replace the field lane',
		(transition) => {
			const classes = toggleVariants({ class: transition }).split(' ');

			expect(classes).toContain(transition);
			expect(classes).not.toContain('transition-field-colors');
		}
	);
});
