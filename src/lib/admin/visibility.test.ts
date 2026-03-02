import { describe, expect, it } from 'vitest';
import type { BetterAuthUser } from '$lib/convex/admin/types';
import { defineField, defineResource } from './builders';
import {
	isFieldDependencySatisfied,
	isFieldDisabled,
	isFieldVisible,
	isRelationAddable,
	isRelationAttachable,
	isRelationDetachable,
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

	describe('relation guards', () => {
		const activeProject = { _id: 'p1', status: 'active' };
		const archivedProject = { _id: 'p2', status: 'archived' };

		const fieldWithGuards = defineField({
			type: 'manyToMany',
			attribute: 'tagIds',
			labelKey: 'admin.resources.projects.fields.tags',
			relation: {
				resourceName: 'demo-tags',
				valueField: '_id',
				labelField: 'name',
				canAdd: (_user, parent) => parent.status !== 'archived',
				canAttach: (_user, parent) => parent.status !== 'archived',
				canDetach: (_user, parent) => parent.status !== 'archived'
			}
		});

		const fieldWithoutGuards = defineField({
			type: 'manyToMany',
			attribute: 'tagIds',
			labelKey: 'admin.resources.projects.fields.tags',
			relation: {
				resourceName: 'demo-tags',
				valueField: '_id',
				labelField: 'name'
			}
		});

		it('allows relation operations when no guards are defined', () => {
			expect(isRelationAddable(fieldWithoutGuards, adminUser, activeProject)).toBe(true);
			expect(isRelationAttachable(fieldWithoutGuards, adminUser, activeProject)).toBe(true);
			expect(isRelationDetachable(fieldWithoutGuards, adminUser, activeProject)).toBe(true);
		});

		it('allows relation operations on active parent', () => {
			expect(isRelationAddable(fieldWithGuards, adminUser, activeProject)).toBe(true);
			expect(isRelationAttachable(fieldWithGuards, adminUser, activeProject)).toBe(true);
			expect(isRelationDetachable(fieldWithGuards, adminUser, activeProject)).toBe(true);
		});

		it('blocks relation operations on archived parent', () => {
			expect(isRelationAddable(fieldWithGuards, adminUser, archivedProject)).toBe(false);
			expect(isRelationAttachable(fieldWithGuards, adminUser, archivedProject)).toBe(false);
			expect(isRelationDetachable(fieldWithGuards, adminUser, archivedProject)).toBe(false);
		});

		it('blocks all relation operations for non-admin users', () => {
			const regularUser: BetterAuthUser = {
				_id: 'user_regular',
				email: 'user@example.com',
				role: 'user'
			};
			expect(isRelationAddable(fieldWithGuards, regularUser, activeProject)).toBe(false);
			expect(isRelationAttachable(fieldWithGuards, regularUser, activeProject)).toBe(false);
			expect(isRelationDetachable(fieldWithGuards, regularUser, activeProject)).toBe(false);
		});

		it('defaults to true when user is admin and no parent record provided', () => {
			expect(isRelationAddable(fieldWithGuards, adminUser, null)).toBe(true);
			expect(isRelationAttachable(fieldWithGuards, adminUser, undefined)).toBe(true);
			expect(isRelationDetachable(fieldWithGuards, adminUser, null)).toBe(true);
		});
	});
});
