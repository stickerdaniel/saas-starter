import { describe, expect, it } from 'vitest';
import { parse } from 'valibot';
import { createResourceUrlSchema, getPageSizeOptions } from './page-helpers';

describe('admin page helpers', () => {
	it('builds page size options from resource config', () => {
		expect(getPageSizeOptions()).toEqual(['5', '10', '20', '50', '100']);
		expect(getPageSizeOptions([25, 50])).toEqual(['25', '50']);
	});

	it('builds URL schema with defaults for filters, lens and trashed', () => {
		const schema = createResourceUrlSchema({
			filters: [{ urlKey: 'status', defaultValue: 'all' }],
			pageSizeOptions: ['10', '20'],
			defaultPageSize: '10'
		});

		const parsed = parse(schema, {
			search: 'abc',
			status: 'active'
		});

		expect(parsed).toEqual({
			search: 'abc',
			sort: '',
			page: '1',
			page_size: '10',
			cursor: '',
			lens: 'all',
			trashed: 'without',
			status: 'active'
		});
	});
});
