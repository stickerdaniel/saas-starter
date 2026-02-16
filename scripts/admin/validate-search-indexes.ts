import fs from 'node:fs';
import path from 'node:path';
import { getResourceDefinitions } from '../../src/lib/admin/registry';
import type { ResourceDefinition } from '../../src/lib/admin/types';
import {
	RESOURCE_SEARCH_INDEXES,
	type ResourceSearchIndexConfig
} from '../../src/lib/convex/adminFramework/utils/search_index';

function getTableBlock(schemaSource: string, tableName: string) {
	const start = schemaSource.indexOf(`${tableName}: defineTable(`);
	if (start < 0) return null;
	const nextTable = schemaSource.indexOf('\n\n\t', start + 1);
	return schemaSource.slice(start, nextTable === -1 ? schemaSource.length : nextTable);
}

function validateConfig(
	resourceName: string,
	config: ResourceSearchIndexConfig | undefined,
	resource: ResourceDefinition<any>,
	schemaSource: string
) {
	const errors: string[] = [];
	if (!config) {
		errors.push(`Missing search index config for resource "${resourceName}".`);
		return errors;
	}

	if (resource.table !== config.table) {
		errors.push(
			`Table mismatch for "${resourceName}": resource.table="${resource.table}" config.table="${config.table}".`
		);
	}

	if (!(resource.search ?? []).includes(config.searchField)) {
		errors.push(
			`Search field "${config.searchField}" for "${resourceName}" is not in resource.search[].`
		);
	}

	const tableBlock = getTableBlock(schemaSource, config.table);
	if (!tableBlock) {
		errors.push(`Table "${config.table}" not found in schema.`);
		return errors;
	}

	if (!tableBlock.includes(`.searchIndex('${config.indexName}'`)) {
		errors.push(`Schema table "${config.table}" is missing searchIndex("${config.indexName}").`);
	}

	if (!tableBlock.includes(`${config.searchField}:`)) {
		errors.push(
			`Schema table "${config.table}" is missing field "${config.searchField}" required by search index config.`
		);
	}

	return errors;
}

function main() {
	const projectRoot = process.cwd();
	const schemaPath = path.join(projectRoot, 'src/lib/convex/schema.ts');
	const schemaSource = fs.readFileSync(schemaPath, 'utf8');
	const resources = getResourceDefinitions();
	const resourcesWithSearch = resources.filter((resource) => (resource.search?.length ?? 0) > 0);
	const errors: string[] = [];

	for (const resource of resourcesWithSearch) {
		const config = RESOURCE_SEARCH_INDEXES[resource.name];
		errors.push(
			...validateConfig(resource.name, config, resource, schemaSource).map(
				(message) => `- ${message}`
			)
		);
	}

	for (const resourceName of Object.keys(RESOURCE_SEARCH_INDEXES)) {
		if (!resources.some((resource) => resource.name === resourceName)) {
			errors.push(
				`- Search index config exists for "${resourceName}" but no registered resource was found.`
			);
		}
	}

	if (errors.length > 0) {
		console.error('Search index validation failed:\n');
		for (const error of errors) {
			console.error(error);
		}
		process.exit(1);
	}

	console.log(
		`Search index validation passed (${resourcesWithSearch.length} searchable resources).`
	);
}

main();
