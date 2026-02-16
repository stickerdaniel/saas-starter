export {};
const [, , rawResource, rawKey = 'actionKey'] = process.argv;

if (!rawResource) {
	console.error('Usage: bun scripts/admin/generate-action.ts <resource-name> [action-key]');
	process.exit(1);
}

const resourceKey = rawResource
	.trim()
	.toLowerCase()
	.replace(/[^a-z0-9-]/g, '-')
	.replace(/-/g, '_');
const key = rawKey.trim();

console.log(`defineAction({
\tkey: '${key}',
\tnameKey: 'admin.resources.${resourceKey}.actions.${key}',
\tshowOnIndex: true,
\tshowOnDetail: true
})`);
