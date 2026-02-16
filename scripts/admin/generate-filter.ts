export {};
const [, , rawResource, rawKey = 'status'] = process.argv;

if (!rawResource) {
	console.error('Usage: bun scripts/admin/generate-filter.ts <resource-name> [filter-key]');
	process.exit(1);
}

const resourceKey = rawResource
	.trim()
	.toLowerCase()
	.replace(/[^a-z0-9-]/g, '-')
	.replace(/-/g, '_');
const key = rawKey.trim();

console.log(`defineFilter({
\tkey: '${key}',
\tlabelKey: 'admin.resources.${resourceKey}.filters.${key}',
\ttype: 'select',
\turlKey: '${key}',
\tdefaultValue: 'all',
\toptions: [
\t\t{ value: 'all', labelKey: 'admin.resources.filters.all' }
\t]
})`);
