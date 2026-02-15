import fs from 'fs';

const [, , rawName] = process.argv;

if (!rawName) {
	console.error('Usage: bun scripts/admin/generate-resource.ts <resource-name>');
	process.exit(1);
}

const safeName = rawName
	.trim()
	.toLowerCase()
	.replace(/[^a-z0-9-]/g, '-');
const fileName = `src/lib/admin/resources/${safeName}.ts`;

if (fs.existsSync(fileName)) {
	console.error(`Resource file already exists: ${fileName}`);
	process.exit(1);
}

const pascal = safeName
	.split('-')
	.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
	.join('');

const template = `import DatabaseIcon from '@lucide/svelte/icons/database';
import { defineResource, defineField } from '../builders';

export const ${pascal}Resource = defineResource({
	name: '${safeName}',
	table: 'adminDemoProjects',
	groupKey: 'admin.resources.groups.demo_data',
	navTitleKey: 'admin.resources.${safeName.replace(/-/g, '_')}.nav_title',
	icon: DatabaseIcon,
	title: (record) => String(record._id),
	fields: [
		defineField({
			type: 'text',
			attribute: '_id',
			labelKey: 'admin.resources.${safeName.replace(/-/g, '_')}.fields.id',
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: false
		})
	]
});
`;

fs.writeFileSync(fileName, template, 'utf8');
console.log(`Created ${fileName}`);
