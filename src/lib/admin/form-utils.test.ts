import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { defineField } from './builders';
import { normalizeFormValues, validateFormValues } from './form-utils';

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
});
