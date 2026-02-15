import { describe, expect, it } from 'vitest';
import {
	getResourceDefinitions,
	getResourceByName,
	getResourceNames,
	isResourceName
} from './registry';
import { getResourceGroups } from './resource-groups';

describe('admin resource registry', () => {
	it('registers demo resources', () => {
		const names = getResourceNames();
		expect(names).toEqual(['demo-projects', 'demo-tasks', 'demo-comments', 'demo-tags']);
		expect(isResourceName('demo-projects')).toBe(true);
		expect(isResourceName('missing-resource')).toBe(false);
		expect(getResourceByName('demo-tasks')?.navTitleKey).toBe('admin.resources.tasks.nav_title');
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
