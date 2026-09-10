import { describe, expect, it } from 'vitest';
import { getMessageProviderFlags, normalizeMessageMetadata } from './provider-metadata';

describe('agent provider metadata adapter', () => {
	it.each([undefined, null, false, 12, 'human', []].map((value) => [value]))(
		'ignores non-record metadata %j',
		(value) => {
			expect(normalizeMessageMetadata(value)).toBeUndefined();
			expect(getMessageProviderFlags(value)).toEqual({
				isAdminMessage: false,
				systemNotice: undefined
			});
		}
	);
	it('preserves a vendor metadata record without copying or fabricating fields', () => {
		const record = { custom: { key: 'value' } };
		expect(normalizeMessageMetadata(record)).toBe(record);
	});
	it('recognizes only boolean admin flags and string notices', () => {
		expect(getMessageProviderFlags({ provider: 'human' }).isAdminMessage).toBe(true);
		expect(
			getMessageProviderFlags({
				providerMetadata: { admin: { isAdminMessage: true }, system: { notice: 'limit' } }
			})
		).toEqual({ isAdminMessage: true, systemNotice: 'limit' });
		expect(
			getMessageProviderFlags({
				providerMetadata: { admin: { isAdminMessage: 'true' }, system: { notice: 12 } }
			})
		).toEqual({ isAdminMessage: false, systemNotice: undefined });
	});
	it.each([null, 'admin', [], { admin: true, system: 1 }].map((value) => [value]))(
		'narrows nested provider data %j',
		(providerMetadata) => {
			expect(getMessageProviderFlags({ providerMetadata })).toEqual({
				isAdminMessage: false,
				systemNotice: undefined
			});
		}
	);
});
