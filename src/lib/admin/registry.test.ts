import { describe, expect, it } from 'vitest';
import {
	getResourceDefinitions,
	getResourceByName,
	getResourceNames,
	getResourceRuntime,
	isResourceName
} from './registry';
import { getResourceGroups } from './resource-groups';

describe('admin resource registry', () => {
	it('discovers all demo resources', () => {
		const names = getResourceNames();
		expect(names).toHaveLength(4);
		expect(names).toContain('demo-projects');
		expect(names).toContain('demo-tasks');
		expect(names).toContain('demo-comments');
		expect(names).toContain('demo-tags');
		expect(isResourceName('demo-projects')).toBe(true);
		expect(isResourceName('missing-resource')).toBe(false);
		expect(getResourceByName('demo-tasks')?.navTitleKey).toBe('admin.resources.tasks.nav_title');
	});

	it('every discovered resource has a runtime', () => {
		for (const name of getResourceNames()) {
			const runtime = getResourceRuntime(name);
			expect(runtime, `runtime for ${name}`).toBeDefined();
			expect(runtime!.list).toBeDefined();
			expect(runtime!.count).toBeDefined();
			expect(runtime!.create).toBeDefined();
			expect(runtime!.update).toBeDefined();
			expect(runtime!.delete).toBeDefined();
			expect(runtime!.getMetrics).toBeDefined();
		}
	});

	it('groups resources by configured group key', () => {
		const groups = getResourceGroups();
		expect(groups).toHaveLength(1);
		expect(groups[0]?.groupKey).toBe('admin.resources.groups.demo_data');
		expect(groups[0]?.resources.map((resource) => resource.name)).toEqual(
			getResourceDefinitions().map((resource) => resource.name)
		);
	});
});
