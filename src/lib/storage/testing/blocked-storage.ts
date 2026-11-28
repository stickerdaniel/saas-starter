import type { StorageKind } from '../web-storage.ts';

export const storageFailures = ['throwing getter', 'null getter', 'refused write'] as const;
type StorageFailure = (typeof storageFailures)[number];

const insecure = () => {
	throw new DOMException('The operation is insecure.', 'SecurityError');
};

function refusingWrites(): Storage {
	const stored = new Map<string, string>();
	return {
		getItem: (key) => stored.get(key) ?? null,
		setItem: () => {
			throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
		},
		removeItem: (key) => void stored.delete(key),
		clear: () => stored.clear(),
		key: (index) => [...stored.keys()][index] ?? null,
		get length() {
			return stored.size;
		}
	};
}

/** Replaces one `window` storage getter the way a blocking browser does; returns the undo. */
export function blockStorage(kind: StorageKind, failure: StorageFailure): () => void {
	const name = kind === 'local' ? 'localStorage' : 'sessionStorage';
	const original = Object.getOwnPropertyDescriptor(window, name);
	Object.defineProperty(
		window,
		name,
		failure === 'throwing getter'
			? { configurable: true, get: insecure }
			: { configurable: true, value: failure === 'null getter' ? null : refusingWrites() }
	);
	return () => {
		if (original) Object.defineProperty(window, name, original);
		else Reflect.deleteProperty(window, name);
	};
}
