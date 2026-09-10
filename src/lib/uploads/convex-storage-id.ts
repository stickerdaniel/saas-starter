import type { GenericId } from 'convex/values';
import { UploadError } from './transfer.js';

/**
 * Convex's successful storage POST returns a plain JSON string. The subsequent
 * generated action requires its erased _storage brand; the browser cannot
 * normalize/verify a database ID locally. Apply that vendor brand only here,
 * after transport parsing, without pretending to validate the opaque encoding.
 * Convex's v.id('_storage') remains authoritative when the commit is executed.
 */
export function storageIdFromUploadResponse(value: unknown): GenericId<'_storage'> {
	if (typeof value !== 'string' || value.length === 0) throw new UploadError('parse');
	return value as GenericId<'_storage'>;
}
