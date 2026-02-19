import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { defineField } from './builders';
import { mapRecordToFormValues, normalizeFormValues, validateFormValues } from './form-utils';

describe('admin form utils', () => {
	it('normalizes number, boolean and morphTo values', () => {
		const fields = [
			defineField({
				type: 'number',
				attribute: 'budget',
				labelKey: 'admin.resources.projects.fields.budget'
			}),
			defineField({
				type: 'boolean',
				attribute: 'isFeatured',
				labelKey: 'admin.resources.projects.fields.featured'
			}),
			defineField({
				type: 'morphTo',
				attribute: 'target',
				labelKey: 'admin.resources.comments.fields.target'
			})
		];

		const output = normalizeFormValues(fields, {
			budget: '42',
			isFeatured: 1,
			target: 'project:abc123'
		});

		expect(output).toEqual({
			budget: 42,
			isFeatured: true,
			target: { kind: 'project', id: 'abc123' }
		});
	});

	it('normalizes currency as number', () => {
		const fields = [
			defineField({
				type: 'currency',
				attribute: 'price',
				labelKey: 'fields.price'
			})
		];

		const output = normalizeFormValues(fields, { price: '1999' });
		expect(output.price).toBe(1999);
	});

	it('normalizes booleanGroup from JSON string', () => {
		const fields = [
			defineField({
				type: 'booleanGroup',
				attribute: 'permissions',
				labelKey: 'fields.permissions',
				options: [
					{ value: 'read', labelKey: 'read' },
					{ value: 'write', labelKey: 'write' }
				]
			})
		];

		const output = normalizeFormValues(fields, {
			permissions: '{"read":true,"write":false}'
		});
		expect(output.permissions).toEqual({ read: true, write: false });
	});

	it('normalizes keyValue from JSON string', () => {
		const fields = [
			defineField({
				type: 'keyValue',
				attribute: 'metadata',
				labelKey: 'fields.metadata'
			})
		];

		const output = normalizeFormValues(fields, {
			metadata: '{"env":"production","region":"us-east"}'
		});
		expect(output.metadata).toEqual({ env: 'production', region: 'us-east' });
	});

	it('skips heading fields during normalization', () => {
		const fields = [
			defineField({
				type: 'heading',
				attribute: 'section',
				labelKey: 'fields.section'
			}),
			defineField({
				type: 'text',
				attribute: 'name',
				labelKey: 'fields.name'
			})
		];

		const output = normalizeFormValues(fields, { section: 'ignored', name: 'hello' });
		expect(output.name).toBe('hello');
		expect(output.section).toBe('ignored');
	});

	it('maps multiselect from record like manyToMany', () => {
		const fields = [
			defineField({
				type: 'multiselect',
				attribute: 'tags',
				labelKey: 'fields.tags',
				options: [
					{ value: 'a', labelKey: 'a' },
					{ value: 'b', labelKey: 'b' }
				]
			})
		];

		const result = mapRecordToFormValues(fields, { tags: ['a', 'b'] });
		expect(result.tags).toEqual(['a', 'b']);
	});

	it('maps booleanGroup from record', () => {
		const fields = [
			defineField({
				type: 'booleanGroup',
				attribute: 'perms',
				labelKey: 'fields.perms',
				options: [
					{ value: 'read', labelKey: 'read' },
					{ value: 'write', labelKey: 'write' }
				]
			})
		];

		const result = mapRecordToFormValues(fields, { perms: { read: true, write: false } });
		expect(result.perms).toEqual({ read: true, write: false });
	});

	it('maps keyValue from record', () => {
		const fields = [
			defineField({
				type: 'keyValue',
				attribute: 'meta',
				labelKey: 'fields.meta'
			})
		];

		const result = mapRecordToFormValues(fields, { meta: { foo: 'bar' } });
		expect(result.meta).toEqual({ foo: 'bar' });
	});

	it('skips heading in mapRecordToFormValues', () => {
		const fields = [
			defineField({
				type: 'heading',
				attribute: 'section',
				labelKey: 'fields.section'
			}),
			defineField({
				type: 'text',
				attribute: 'name',
				labelKey: 'fields.name'
			})
		];

		const result = mapRecordToFormValues(fields, { section: 'x', name: 'hello' });
		expect(result.section).toBeUndefined();
		expect(result.name).toBe('hello');
	});

	it('validates required and rules-based fields', () => {
		const fields = [
			defineField({
				type: 'text',
				attribute: 'name',
				labelKey: 'admin.resources.projects.fields.name',
				required: true,
				rules: v.pipe(v.string(), v.minLength(3))
			})
		];

		const t = (key: string) => key;
		const requiredErrors = validateFormValues({
			fields,
			values: { name: '' },
			isEdit: false,
			t
		});
		expect(requiredErrors.name).toBe('admin.resources.form.required');

		const ruleErrors = validateFormValues({
			fields,
			values: { name: 'ab' },
			isEdit: false,
			t
		});
		expect(ruleErrors.name).toBeTruthy();
	});

	it('skips heading, booleanGroup, multiselect, keyValue in required validation', () => {
		const t = (key: string) => key;
		const fields = [
			defineField({
				type: 'heading',
				attribute: 'section',
				labelKey: 'fields.section',
				required: true
			}),
			defineField({
				type: 'booleanGroup',
				attribute: 'perms',
				labelKey: 'fields.perms',
				required: true,
				options: [{ value: 'read', labelKey: 'read' }]
			}),
			defineField({
				type: 'multiselect',
				attribute: 'tags',
				labelKey: 'fields.tags',
				required: true,
				options: [{ value: 'a', labelKey: 'a' }]
			}),
			defineField({
				type: 'keyValue',
				attribute: 'meta',
				labelKey: 'fields.meta',
				required: true
			})
		];

		const errors = validateFormValues({
			fields,
			values: { section: '', perms: {}, tags: [], meta: {} },
			isEdit: false,
			t
		});

		expect(Object.keys(errors)).toHaveLength(0);
	});
});
