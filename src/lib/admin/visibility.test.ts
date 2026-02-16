import { describe, expect, it } from 'vitest';
import type { BetterAuthUser } from '$lib/convex/admin/types';
import { defineField, defineResource } from './builders';
import {
	isFieldDependencySatisfied,
	isFieldDisabled,
	isFieldVisible,
	isResourceVisible
} from './visibility';

const adminUser: BetterAuthUser = {
	_id: 'user_admin',
	email: 'admin@example.com',
	role: 'admin'
};

describe('admin visibility helpers', () => {
	it('checks resource visibility with canSee', () => {
		const resource = defineResource({
			name: 'demo',
			table: 'adminDemoProjects',
			groupKey: 'admin.resources.groups.demo_data',
			navTitleKey: 'admin.resources.projects.nav_title',
			icon: {} as any,
			title: () => 'Demo',
			fields: [],
			canSee: (user) => user.role === 'admin'
		});

		expect(isResourceVisible(resource, adminUser)).toBe(true);
		expect(isResourceVisible(resource, undefined)).toBe(false);
	});

	it('honors field dependency and disabled guards', () => {
		const dependentField = defineField({
			type: 'text',
			attribute: 'notes',
			labelKey: 'admin.resources.projects.fields.description',
			dependsOn: { field: 'status', value: 'active' }
		});

		expect(isFieldDependencySatisfied(dependentField, { status: 'active' })).toBe(true);
		expect(isFieldDependencySatisfied(dependentField, { status: 'draft' })).toBe(false);

		const immutableField = defineField({
			type: 'text',
			attribute: 'slug',
			labelKey: 'admin.resources.projects.fields.slug',
			immutable: true
		});

		expect(isFieldDisabled(immutableField, { user: adminUser, record: null, isEdit: true })).toBe(
			true
		);
		expect(isFieldDisabled(immutableField, { user: adminUser, record: null, isEdit: false })).toBe(
			false
		);
	});

	it('uses _visibleFields from record payload', () => {
		const field = defineField({
			type: 'text',
			attribute: 'secret',
			labelKey: 'admin.resources.projects.fields.name'
		});

		expect(
			isFieldVisible(field, {
				user: adminUser,
				record: { _visibleFields: ['name'] }
			})
		).toBe(false);
		expect(
			isFieldVisible(field, {
				user: adminUser,
				record: { _visibleFields: ['secret'] }
			})
		).toBe(true);
	});
});
