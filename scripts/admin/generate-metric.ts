const [, , rawResource, rawKey = 'total', rawType = 'value'] = process.argv;

if (!rawResource) {
	console.error('Usage: bun scripts/admin/generate-metric.ts <resource-name> [metric-key] [type]');
	process.exit(1);
}

const resourceKey = rawResource
	.trim()
	.toLowerCase()
	.replace(/[^a-z0-9-]/g, '-')
	.replace(/-/g, '_');
const key = rawKey.trim();
const type = rawType.trim();

console.log(`defineMetric({
\tkey: '${key}',
\ttype: '${type}',
\tlabelKey: 'admin.resources.${resourceKey}.metrics.${key}'
})`);
