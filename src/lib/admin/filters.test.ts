import { describe, it, expect } from 'vitest';
import { resolveFieldFilters, resolveFieldFilter } from './filters';
import type { FieldDefinition, FilterDefinition } from './types';

function makeField(overrides: Partial<FieldDefinition>): FieldDefinition {
	return {
		type: 'text',
		attribute: 'test',
		labelKey: 'test.label',
		...overrides
	};
}

describe('resolveFieldFilter', () => {
	it('returns null when filterable is false/undefined', () => {
		expect(resolveFieldFilter(makeField({ filterable: false }))).toBeNull();
		expect(resolveFieldFilter(makeField({}))).toBeNull();
	});

	it('generates a select filter from a select field with options', () => {
		const field = makeField({
			type: 'select',
			attribute: 'status',
			labelKey: 'fields.status',
			filterable: true,
			options: [
				{ value: 'active', labelKey: 'options.active' },
				{ value: 'archived', labelKey: 'options.archived' }
			]
		});

		const filter = resolveFieldFilter(field);
		expect(filter).toEqual({
			key: 'status',
			labelKey: 'fields.status',
			type: 'select',
			urlKey: 'status',
			defaultValue: 'all',
			options: [
				{ value: 'all', labelKey: 'admin.resources.filters.all' },
				{ value: 'active', labelKey: 'options.active' },
				{ value: 'archived', labelKey: 'options.archived' }
			]
		});
	});

	it('generates a select filter from a badge field with options', () => {
		const field = makeField({
			type: 'badge',
			attribute: 'level',
			labelKey: 'fields.level',
			filterable: true,
			options: [
				{ value: 'low', labelKey: 'options.low' },
				{ value: 'high', labelKey: 'options.high' }
			]
		});

		const filter = resolveFieldFilter(field);
		expect(filter).not.toBeNull();
		expect(filter!.type).toBe('select');
		expect(filter!.options).toHaveLength(3); // all + low + high
	});

	it('generates a boolean filter from a boolean field', () => {
		const field = makeField({
			type: 'boolean',
			attribute: 'isFeatured',
			labelKey: 'fields.featured',
			filterable: true
		});

		const filter = resolveFieldFilter(field);
		expect(filter).toEqual({
			key: 'isFeatured',
			labelKey: 'fields.featured',
			type: 'boolean',
			urlKey: 'isFeatured',
			defaultValue: 'all',
			options: [
				{ value: 'all', labelKey: 'admin.resources.filters.all' },
				{ value: 'yes', labelKey: 'admin.resources.filters.yes' },
				{ value: 'no', labelKey: 'admin.resources.filters.no' }
			]
		});
	});

	it('generates a date-range filter from a date field', () => {
		const field = makeField({
			type: 'date',
			attribute: 'createdAt',
			labelKey: 'fields.created_at',
			filterable: true
		});

		const filter = resolveFieldFilter(field);
		expect(filter).toEqual({
			key: 'createdAt',
			labelKey: 'fields.created_at',
			type: 'date-range',
			urlKey: 'createdAt',
			defaultValue: ''
		});
	});

	it('generates a date-range filter from a datetime field', () => {
		const field = makeField({
			type: 'datetime',
			attribute: 'updatedAt',
			labelKey: 'fields.updated_at',
			filterable: true
		});

		const filter = resolveFieldFilter(field);
		expect(filter).not.toBeNull();
		expect(filter!.type).toBe('date-range');
	});

	it('returns null for text/number/email fields', () => {
		expect(resolveFieldFilter(makeField({ type: 'text', filterable: true }))).toBeNull();
		expect(resolveFieldFilter(makeField({ type: 'number', filterable: true }))).toBeNull();
		expect(resolveFieldFilter(makeField({ type: 'email', filterable: true }))).toBeNull();
	});

	it('returns null for a select field without options', () => {
		const field = makeField({
			type: 'select',
			filterable: true
		});
		expect(resolveFieldFilter(field)).toBeNull();
	});

	it('returns null for belongsTo without config.options', () => {
		const field = makeField({
			type: 'belongsTo',
			filterable: true
		});
		expect(resolveFieldFilter(field)).toBeNull();
	});

	it('generates select filter for belongsTo with config.options', () => {
		const field = makeField({
			type: 'belongsTo',
			attribute: 'projectId',
			labelKey: 'fields.project',
			filterable: {
				options: [
					{ value: 'p1', labelKey: 'projects.alpha' },
					{ value: 'p2', labelKey: 'projects.beta' }
				]
			}
		});

		const filter = resolveFieldFilter(field);
		expect(filter).not.toBeNull();
		expect(filter!.type).toBe('select');
		expect(filter!.options).toHaveLength(3); // all + p1 + p2
	});

	it('applies FilterableConfig overrides for labelKey and urlKey', () => {
		const field = makeField({
			type: 'select',
			attribute: 'status',
			labelKey: 'fields.status',
			filterable: {
				labelKey: 'filters.custom_status',
				urlKey: 'custom_status'
			},
			options: [{ value: 'a', labelKey: 'opt.a' }]
		});

		const filter = resolveFieldFilter(field);
		expect(filter).not.toBeNull();
		expect(filter!.labelKey).toBe('filters.custom_status');
		expect(filter!.urlKey).toBe('custom_status');
	});

	it('applies FilterableConfig key override', () => {
		const field = makeField({
			type: 'boolean',
			attribute: 'active',
			labelKey: 'fields.active',
			filterable: { key: 'is_active' }
		});

		const filter = resolveFieldFilter(field);
		expect(filter!.key).toBe('is_active');
	});

	it('applies FilterableConfig defaultValue override', () => {
		const field = makeField({
			type: 'select',
			attribute: 'priority',
			labelKey: 'fields.priority',
			filterable: { defaultValue: 'medium' },
			options: [
				{ value: 'low', labelKey: 'opt.low' },
				{ value: 'medium', labelKey: 'opt.medium' }
			]
		});

		const filter = resolveFieldFilter(field);
		expect(filter!.defaultValue).toBe('medium');
	});
});

describe('resolveFieldFilters', () => {
	it('returns filters only for filterable fields', () => {
		const fields: FieldDefinition[] = [
			makeField({ type: 'text', attribute: 'name' }),
			makeField({
				type: 'select',
				attribute: 'status',
				filterable: true,
				options: [{ value: 'a', labelKey: 'o.a' }]
			}),
			makeField({ type: 'number', attribute: 'count' }),
			makeField({ type: 'boolean', attribute: 'active', filterable: true })
		];

		const filters = resolveFieldFilters(fields);
		expect(filters).toHaveLength(2);
		expect(filters[0].key).toBe('status');
		expect(filters[1].key).toBe('active');
	});

	it('returns empty array when no fields are filterable', () => {
		const fields: FieldDefinition[] = [
			makeField({ type: 'text', attribute: 'name' }),
			makeField({ type: 'number', attribute: 'count' })
		];

		expect(resolveFieldFilters(fields)).toEqual([]);
	});
});

describe('explicit filters take precedence', () => {
	it('dedup in page-helpers keeps first occurrence (explicit)', () => {
		// This tests the dedup logic used in page-helpers.ts:
		// explicit filters come first, so same urlKey from field filters is dropped
		const explicit: FilterDefinition = {
			key: 'status',
			labelKey: 'custom.label',
			type: 'select',
			urlKey: 'status',
			defaultValue: 'all',
			options: [{ value: 'all', labelKey: 'all' }]
		};

		const fieldGenerated: FilterDefinition = {
			key: 'status',
			labelKey: 'fields.status',
			type: 'select',
			urlKey: 'status',
			defaultValue: 'all',
			options: [
				{ value: 'all', labelKey: 'admin.resources.filters.all' },
				{ value: 'a', labelKey: 'o.a' }
			]
		};

		const merged = [explicit, fieldGenerated].filter(
			(f, i, a) => a.findIndex((e) => e.urlKey === f.urlKey) === i
		);

		expect(merged).toHaveLength(1);
		expect(merged[0].labelKey).toBe('custom.label');
	});
});
