import type { ResourceDefinition } from './types';
import { demoCommentsResource } from './resources/demo-comments';
import { demoProjectsResource } from './resources/demo-projects';
import { demoTagsResource } from './resources/demo-tags';
import { demoTasksResource } from './resources/demo-tasks';

const RESOURCE_REGISTRY = [
	demoProjectsResource,
	demoTasksResource,
	demoCommentsResource,
	demoTagsResource
] as const satisfies readonly ResourceDefinition<any>[];

const RESOURCE_MAP = new Map<string, ResourceDefinition<any>>(
	RESOURCE_REGISTRY.map((resource) => [resource.name, resource])
);

export function getResourceDefinitions() {
	return RESOURCE_REGISTRY;
}

export function getResourceByName(name: string) {
	return RESOURCE_MAP.get(name);
}

export function getResourceNames() {
	return RESOURCE_REGISTRY.map((resource) => resource.name);
}

export function isResourceName(value: string) {
	return RESOURCE_MAP.has(value);
}
