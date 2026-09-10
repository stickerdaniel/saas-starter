import { describe, expect, expectTypeOf, it } from 'vitest';
import type { GenericId } from 'convex/values';
import { storageIdFromUploadResponse } from './convex-storage-id';
import { UploadError } from './transfer';

describe('Convex storage response branding adapter', () => {
	it('preserves the opaque server ID and adds only the storage-table brand', () => {
		expect(storageIdFromUploadResponse('opaque-storage-id')).toBe('opaque-storage-id');
		expectTypeOf<ReturnType<typeof storageIdFromUploadResponse>>().toEqualTypeOf<
			GenericId<'_storage'>
		>();
		expectTypeOf<string>().not.toExtend<ReturnType<typeof storageIdFromUploadResponse>>();
	});
	it.each([undefined, null, '', 42, {}, []].map((value) => [value]))(
		'rejects malformed storage payload %j',
		(value) => {
			expect(() => storageIdFromUploadResponse(value)).toThrow(UploadError);
			expect(() => storageIdFromUploadResponse(value)).toThrow('Malformed upload response');
		}
	);
});
