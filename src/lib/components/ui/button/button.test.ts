import { describe, expect, it } from 'vitest';
import { cn } from '$lib/utils.js';
import { buttonVariants } from './button.svelte';

describe('buttonVariants', () => {
	it('keeps the one-pixel press immediate', () => {
		const classes = buttonVariants();

		expect(classes).toContain('active:not-aria-[haspopup]:translate-y-px');
		expect(classes).toContain('transition-[color,background-color,border-color,box-shadow]');
		expect(classes).not.toContain('transition-all');
	});

	it('lets intentional transform animations suppress the translate', () => {
		const classes = cn(
			buttonVariants(),
			'active:not-aria-[haspopup]:translate-y-0 active:scale-[0.97]'
		);

		expect(classes).not.toContain('active:not-aria-[haspopup]:translate-y-px');
		expect(classes).toContain('active:not-aria-[haspopup]:translate-y-0');
		expect(classes).toContain('active:scale-[0.97]');
	});
});
