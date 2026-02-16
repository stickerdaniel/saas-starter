import { describe, expect, it } from 'vitest';
import { defineField, defineResource } from './builders';
import { resolveFieldGroups } from './field-groups';

describe('admin field groups', () => {
	it('falls back to single main group when resource has no group config', () => {
		const fields = [
			defineField({ type: 'text', attribute: 'name', labelKey: 'admin.test.name' }),
			defineField({ type: 'text', attribute: 'slug', labelKey: 'admin.test.slug' })
		];
		const resource = defineResource({
			name: 'test',
			table: 'adminDemoTags',
			groupKey: 'admin.resources.groups.demo_data',
			navTitleKey: 'admin.test.nav',
			icon: (() => null) as never,
			title: () => 'x',
			fields
		});

		const grouped = resolveFieldGroups({
			resource,
			context: 'detail',
			fields
		});
		expect(grouped).toHaveLength(1);
		expect(grouped[0]?.key).toBe('main');
	});

	it('splits fields into configured groups and keeps ungrouped fields', () => {
		const fields = [
			defineField({ type: 'text', attribute: 'name', labelKey: 'admin.test.name' }),
			defineField({ type: 'text', attribute: 'slug', labelKey: 'admin.test.slug' }),
			defineField({ type: 'text', attribute: 'notes', labelKey: 'admin.test.notes' })
		];
		const resource = defineResource({
			name: 'test',
			table: 'adminDemoTags',
			groupKey: 'admin.resources.groups.demo_data',
			navTitleKey: 'admin.test.nav',
			icon: (() => null) as never,
			title: () => 'x',
			fields,
			fieldGroups: [
				{
					key: 'overview',
					labelKey: 'admin.resources.groups.overview',
					contexts: ['detail'],
					fields: ['name', 'slug']
				}
			]
		});

		const grouped = resolveFieldGroups({
			resource,
			context: 'detail',
			fields
		});
		expect(grouped.map((group) => group.key)).toEqual(['overview', 'other']);
		expect(grouped[0]?.fields.map((field) => field.attribute)).toEqual(['name', 'slug']);
		expect(grouped[1]?.fields.map((field) => field.attribute)).toEqual(['notes']);
	});
});
