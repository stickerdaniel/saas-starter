import type { ResourceDefinition, ResourceModule, ResourceRuntime } from './types';

const modules = import.meta.glob('./resources/*.ts', { eager: true }) as Record<
	string,
	{ default?: ResourceModule }
>;

const RESOURCE_REGISTRY: ResourceDefinition<any>[] = [];
const RESOURCE_MAP = new Map<string, ResourceDefinition<any>>();
const RUNTIME_MAP = new Map<string, ResourceRuntime>();

for (const [, mod] of Object.entries(modules)) {
	const resourceModule = mod.default;
	if (!resourceModule?.resource || !resourceModule?.runtime) continue;
	RESOURCE_REGISTRY.push(resourceModule.resource);
	RESOURCE_MAP.set(resourceModule.resource.name, resourceModule.resource);
	RUNTIME_MAP.set(resourceModule.resource.name, resourceModule.runtime);
}

export function getResourceDefinitions(): readonly ResourceDefinition<any>[] {
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

export function getResourceRuntime(name: string): ResourceRuntime | undefined {
	return RUNTIME_MAP.get(name);
}

export function getResourceRuntimeMap(): ReadonlyMap<string, ResourceRuntime> {
	return RUNTIME_MAP;
}
