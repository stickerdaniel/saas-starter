const [, , rawResource, rawKey = 'default'] = process.argv;

if (!rawResource) {
	console.error('Usage: bun scripts/admin/generate-lens.ts <resource-name> [lens-key]');
	process.exit(1);
}

const resourceKey = rawResource
	.trim()
	.toLowerCase()
	.replace(/[^a-z0-9-]/g, '-')
	.replace(/-/g, '_');
const key = rawKey.trim();

console.log(`defineLens({
\tkey: '${key}',
\tnameKey: 'admin.resources.${resourceKey}.lenses.${key}'
})`);
