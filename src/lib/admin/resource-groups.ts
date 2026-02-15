import type { ResourceGroup } from './types';
import { getResourceDefinitions } from './registry';

export function getResourceGroups(): ResourceGroup[] {
	const groups = new Map<string, ResourceGroup>();

	for (const resource of getResourceDefinitions()) {
		const existing = groups.get(resource.groupKey);
		if (existing) {
			existing.resources.push(resource);
			continue;
		}
		groups.set(resource.groupKey, {
			groupKey: resource.groupKey,
			resources: [resource]
		});
	}

	return [...groups.values()];
}
