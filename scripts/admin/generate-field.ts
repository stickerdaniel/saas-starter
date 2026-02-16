const [, , rawResource, rawAttribute = 'name', rawType = 'text'] = process.argv;

if (!rawResource) {
	console.error('Usage: bun scripts/admin/generate-field.ts <resource-name> [attribute] [type]');
	process.exit(1);
}

const resourceKey = rawResource
	.trim()
	.toLowerCase()
	.replace(/[^a-z0-9-]/g, '-')
	.replace(/-/g, '_');
const attribute = rawAttribute.trim();
const type = rawType.trim();

console.log(`defineField({
\ttype: '${type}',
\tattribute: '${attribute}',
\tlabelKey: 'admin.resources.${resourceKey}.fields.${attribute}',
\tshowOnIndex: true,
\tshowOnDetail: true,
\tshowOnForm: true
})`);
