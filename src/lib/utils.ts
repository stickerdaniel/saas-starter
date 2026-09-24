import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Theme values and utilities from layout.css that tailwind-merge cannot infer from a
// name. Without them a caller's transition-all would sit beside a primitive's
// transition-control-colors, and stylesheet order rather than the caller would win.
const twMerge = extendTailwindMerge({
	extend: {
		theme: {
			leading: ['composer'],
			animate: [
				'wave-bars',
				'spinner-fade',
				'bounce-dots',
				'pulse-dot',
				'thin-pulse',
				'blink',
				'text-blink',
				'loading-dots',
				'typing',
				'wave',
				'chip-in'
			]
		},
		classGroups: {
			transition: [{ transition: ['control-colors', 'field-colors'] }]
		}
	}
});

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export type WithoutChild<T> = T extends { child?: any } ? Omit<T, 'child'> : T;

export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
