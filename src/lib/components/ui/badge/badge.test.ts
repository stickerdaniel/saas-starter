import { describe, expect, it } from 'vitest';
import { cn } from '$lib/utils.js';
import { badgeVariants } from './badge.svelte';

// Each option replaces caller classes that restyled a Badge, so it must merge to the
// same classes as that caller markup did.
describe('badgeVariants options', () => {
	const classSet = (classes: string) => new Set(cn(classes).split(' '));
	const secondary = badgeVariants({ variant: 'secondary' });
	const outline = badgeVariants({ variant: 'outline' });

	it.each([
		[
			'success',
			cn(secondary, 'bg-success/10 text-success dark:bg-success/20'),
			{ variant: 'success' }
		],
		[
			'warning',
			cn(secondary, 'bg-warning/10 text-warning dark:bg-warning/20'),
			{ variant: 'warning' }
		],
		['info', cn(secondary, 'bg-info/10 text-info dark:bg-info/20'), { variant: 'info' }],
		[
			'primary-subtle',
			cn(secondary, 'bg-primary/10 text-primary dark:bg-primary/20'),
			{ variant: 'primary-subtle' }
		],
		[
			'bordered-success',
			cn(outline, 'border-success bg-success/10 text-success'),
			{ variant: 'bordered-success' }
		],
		[
			'bordered-warning',
			cn(outline, 'border-warning bg-warning/10 text-warning'),
			{ variant: 'bordered-warning' }
		],
		[
			'bordered-destructive',
			cn(outline, 'border-destructive bg-destructive/10 text-destructive'),
			{ variant: 'bordered-destructive' }
		],
		[
			'premium',
			cn(
				badgeVariants(),
				'h-auto bg-premium/15 px-1.5 py-0.5 text-2xs leading-none text-premium-foreground'
			),
			{ variant: 'premium' }
		],
		['chip', cn(secondary, 'h-8 gap-1.5 pr-1 pl-2.5'), { variant: 'secondary', size: 'chip' }],
		[
			'attached last-used label',
			cn(
				secondary,
				'px-1.5 py-0 text-2xs transition-colors group-has-[[data-slot=button]:active:not([aria-haspopup])]:translate-y-px group-has-[[data-slot=button]:disabled]:badge-secondary-disabled'
			),
			{ variant: 'secondary', size: 'xs', attachment: 'oauth-last-used' }
		]
	] as const)('%s', (_, before, options) => {
		expect(classSet(badgeVariants(options))).toEqual(classSet(before));
	});
});
