import { PersistedState } from 'runed';

// Backward-compatible serializer:
// Legacy clients wrote raw strings via localStorage.setItem('supportUserId', id) like `anon_abc123`.
// JSON.parse('anon_abc123') throws; the default JSON serializer would silently drop the value,
// orphan the user's existing anonymous tickets, and generate a fresh ID. This serializer
// tolerates both formats on read, writes JSON on write.
const serializer = {
	serialize: JSON.stringify,
	deserialize: (raw: string): string | null | undefined => {
		try {
			const parsed: unknown = JSON.parse(raw);
			if (parsed === null || typeof parsed === 'string') return parsed;
			// Valid JSON but unexpected type (number, boolean, array, object).
			// Treat as cleared so callers like isAnonymousUser don't crash on .startsWith.
			return null;
		} catch {
			return raw; // legacy raw-string format
		}
	}
};

// Initial value is `undefined` (not `null`) so PersistedState does not eagerly write to storage
// on import. The constructor writes the initial value when the key is absent, and #serialize
// is a no-op for `undefined`.
export const supportUserId = new PersistedState<string | null | undefined>(
	'supportUserId',
	undefined,
	{ serializer }
);
