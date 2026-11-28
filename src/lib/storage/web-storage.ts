/**
 * The one way into Web Storage outside analytics.
 *
 * A browser that blocks site data throws a `SecurityError` from the
 * `localStorage` getter itself, some webviews return `null` from it, and a full
 * quota throws from `setItem`. Every function here acquires the storage object
 * and runs its operation in one `try`, so none of them can throw, and each
 * reports an unavailable store in its return value. Without `window`, as during
 * SSR, every store is unavailable.
 */

export type StorageKind = 'local' | 'session';

function access<T>(kind: StorageKind, operation: (storage: Storage) => T): T | undefined {
	if (typeof window === 'undefined') return undefined;
	try {
		const storage: Storage | null = kind === 'local' ? window.localStorage : window.sessionStorage;
		return storage ? operation(storage) : undefined;
	} catch {
		return undefined;
	}
}

/** The stored value, `null` for a missing key, `undefined` when the store is unavailable. */
export function readItem(kind: StorageKind, key: string): string | null | undefined {
	return access(kind, (storage) => storage.getItem(key));
}

/** Whether the store accepted the value. */
export function writeItem(kind: StorageKind, key: string, value: string): boolean {
	return (
		access(kind, (storage) => {
			storage.setItem(key, value);
			return true;
		}) ?? false
	);
}

/** Whether the store removed the key, or never held it. */
export function removeItem(kind: StorageKind, key: string): boolean {
	return (
		access(kind, (storage) => {
			storage.removeItem(key);
			return true;
		}) ?? false
	);
}

/** Every key in the store, `undefined` when the store is unavailable. */
export function listKeys(kind: StorageKind): string[] | undefined {
	return access(kind, (storage) =>
		Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
			(key) => key !== null
		)
	);
}

/**
 * Whether a write reads back and removes cleanly. Safari's private mode and a
 * full quota read fine and refuse every write, so a read alone proves nothing.
 */
export function usable(kind: StorageKind): boolean {
	const probe = `__storage_probe_${Math.random().toString(36).slice(2)}__`;
	return (
		access(kind, (storage) => {
			storage.setItem(probe, probe);
			const readBack = storage.getItem(probe);
			storage.removeItem(probe);
			return readBack === probe && storage.getItem(probe) === null;
		}) ?? false
	);
}
