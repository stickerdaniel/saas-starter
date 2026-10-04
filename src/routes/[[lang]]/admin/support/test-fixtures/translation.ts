import { writable } from 'svelte/store';

type Translate = (key: string, params?: Record<string, unknown>) => string;

/**
 * Stands in for Tolgee's translate store: a new function whenever the language
 * changes, resolved against a checked-in dictionary.
 */
export const translation = writable<Translate>(() => '');

export function useDictionary(dictionary: object) {
	translation.set((key, params = {}) => {
		const template = key
			.split('.')
			.reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], dictionary);
		if (typeof template !== 'string') throw new Error(`Missing translation ${key}`);
		return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name]));
	});
}
