import { PersistedState } from 'runed';
import { usable } from './web-storage.ts';

export type Persisted<T> = { current: T };

type PersistedOptions<T> = ConstructorParameters<typeof PersistedState<T>>[2];

function inMemory<T>(initial: T): Persisted<T> {
	let current = $state(initial);
	return {
		get current() {
			return current;
		},
		set current(next) {
			current = next;
		}
	};
}

/**
 * Runed's `PersistedState` when the browser lets the page store data, otherwise
 * deeply reactive state that lasts for the document.
 *
 * `PersistedState` reads the storage getter and calls `getItem` in its
 * constructor, so blocked storage would throw on import and break hydration.
 * Without `window`, as during SSR, it is built as is: it keeps the initial value
 * there and stores nothing.
 */
export function persisted<T>(key: string, initial: T, options?: PersistedOptions<T>): Persisted<T> {
	if (typeof window !== 'undefined' && !usable(options?.storage ?? 'local')) {
		return inMemory(initial);
	}
	try {
		return new PersistedState(key, initial, options);
	} catch {
		return inMemory(initial);
	}
}
