import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import {
	createTableUrlSchema,
	omitDefaultTableUrlState,
	parseCursorParam,
	parsePageIndex,
	parseSortParam,
	serializeCursorParam,
	serializeSortParam
} from './url';
import type { TableUrlState } from './contract';

describe('table URL helpers', () => {
	it('parses sort params in canonical format only', () => {
		expect(parseSortParam('email.asc', ['email', 'name'] as const)).toEqual({
			field: 'email',
			direction: 'asc'
		});
		expect(parseSortParam('name:desc', ['email', 'name'] as const)).toBeUndefined();
	});

	it('serializes sort using canonical field.dir format', () => {
		expect(serializeSortParam({ field: 'role', direction: 'asc' })).toBe('role.asc');
		expect(serializeSortParam(undefined)).toBe('');
	});

	it('parses page values to zero-based page index', () => {
		expect(parsePageIndex('1')).toBe(0);
		expect(parsePageIndex('3')).toBe(2);
		expect(parsePageIndex('0')).toBe(0);
		expect(parsePageIndex('abc')).toBe(0);
	});

	it('omits default/empty values for clean URLs', () => {
		const defaults: TableUrlState<'role' | 'status'> = {
			search: '',
			sort: '',
			page: '1',
			page_size: '10',
			cursor: '',
			role: 'all',
			status: 'all'
		};
		const state: TableUrlState<'role' | 'status'> = {
			...defaults,
			search: 'alice',
			role: 'admin',
			page: '2',
			cursor: 'cursor-2'
		};

		expect(omitDefaultTableUrlState(state, defaults)).toEqual({
			search: 'alice',
			role: 'admin',
			page: '2',
			cursor: 'cursor-2'
		});
	});

	it('keeps simple cursors readable and encodes opaque cursors safely', () => {
		expect(serializeCursorParam('20')).toBe('20');

		const opaque = '[1771020343775.6047,"k5711m3pqrt469rbfzbxnxk1fh812270"]';
		const serialized = serializeCursorParam(opaque);
		expect(serialized.startsWith('b64.')).toBe(true);
		expect(parseCursorParam(serialized)).toBe(opaque);
	});

	it('rejects malformed encoded cursors', () => {
		expect(parseCursorParam('b64.%%%')).toBe(null);
	});
});

describe('createTableUrlSchema', () => {
	const schema = createTableUrlSchema({
		filters: { role: ['all', 'admin', 'user'], admin: 'text' },
		pageSizes: [1, 10, 20],
		defaultPageSize: 10
	});
	const defaults = {
		search: '',
		role: 'all',
		admin: '',
		sort: '',
		page: '1',
		page_size: '10',
		cursor: ''
	};

	it('fills every missing param with its default', () => {
		expect(v.parse(schema, {})).toEqual(defaults);
	});

	it('keeps valid params', () => {
		const state = {
			search: 'alice',
			role: 'admin',
			admin: 'user_1',
			sort: 'email.asc',
			page: '3',
			page_size: '20',
			cursor: 'b64.abc'
		};
		expect(v.parse(schema, state)).toEqual(state);
	});

	it('falls back for values outside a picklist or the page sizes', () => {
		expect(v.parse(schema, { role: 'owner', page_size: '40' })).toEqual(defaults);
		expect(v.parse(schema, { role: 'All', page_size: '0' })).toEqual(defaults);
	});

	it('falls back for non-string values', () => {
		expect(
			v.parse(schema, {
				search: 1,
				role: ['admin'],
				admin: null,
				sort: {},
				page: 2,
				page_size: 20,
				cursor: false
			})
		).toEqual(defaults);
	});
});
