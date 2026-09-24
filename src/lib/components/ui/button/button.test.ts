import { describe, expect, it } from 'vitest';
import { cn } from '$lib/utils.js';
import { buttonVariants } from './button.svelte';

describe('buttonVariants', () => {
	it('keeps the one-pixel press immediate', () => {
		const classes = buttonVariants();

		expect(classes).toContain('active:not-aria-[haspopup]:translate-y-px');
		expect(classes).toContain('transition-control-colors');
		expect(classes).not.toContain('transition-all');
	});

	it('lets a caller transition replace the color lane', () => {
		const classes = cn(buttonVariants(), 'transition-all').split(' ');

		expect(classes).toContain('transition-all');
		expect(classes).not.toContain('transition-control-colors');
	});

	it.each(['transition-all', 'transition-colors'])(
		'lets a caller %s passed to the helper replace the color lane',
		(transition) => {
			const classes = buttonVariants({ class: transition }).split(' ');

			expect(classes).toContain(transition);
			expect(classes).not.toContain('transition-control-colors');
		}
	);

	it('lets the theme pill radius replace the base radius and yield to a caller radius', () => {
		const pill = cn('min-w-0 rounded-theme-pill px-4');
		const classes = cn(buttonVariants({ variant: 'outline', size: 'lg' }), pill).split(' ');

		expect(classes).toContain('rounded-theme-pill');
		expect(classes).not.toContain('rounded-md');

		const overridden = cn('min-w-0 rounded-theme-pill px-4', 'rounded-md').split(' ');
		expect(overridden).toContain('rounded-md');
		expect(overridden).not.toContain('rounded-theme-pill');

		const helper = buttonVariants({ class: 'rounded-theme-pill' }).split(' ');
		expect(helper).toContain('rounded-theme-pill');
		expect(helper).not.toContain('rounded-md');
	});

	it('lets intentional transform animations suppress the translate', () => {
		const classes = cn(
			buttonVariants(),
			'active:not-aria-[haspopup]:translate-y-0 active:scale-97'
		);

		expect(classes).not.toContain('active:not-aria-[haspopup]:translate-y-px');
		expect(classes).toContain('active:not-aria-[haspopup]:translate-y-0');
		expect(classes).toContain('active:scale-97');
	});
});
