import fs from 'fs';
import path from 'path';
import {
	intro,
	outro,
	text,
	select,
	multiselect,
	confirm,
	group,
	cancel,
	isCancel,
	spinner,
	note
} from '@clack/prompts';

// ── Paths ──────────────────────────────────────────────────────────────
const ROOT = path.resolve(import.meta.dir, '../..');
const FRONTEND_DIR = path.join(ROOT, 'src/lib/admin/resources');
const BACKEND_DIR = path.join(ROOT, 'src/lib/convex/adminFramework/resources');
const I18N_DIR = path.join(ROOT, 'src/i18n');
const SEARCH_INDEX_PATH = path.join(ROOT, 'src/lib/convex/adminFramework/utils/search_index.ts');
const GUARDS_PATH = path.join(ROOT, 'src/lib/convex/adminFramework/utils/resource_guards.ts');
const LOCALES = ['en', 'de', 'es', 'fr'] as const;

// ── Field types ────────────────────────────────────────────────────────
const FIELD_TYPES = [
	'text',
	'textarea',
	'number',
	'boolean',
	'select',
	'date',
	'datetime',
	'image',
	'file',
	'email',
	'url',
	'json',
	'code',
	'markdown',
	'badge'
] as const;

// ── Helpers ────────────────────────────────────────────────────────────
function toKebab(input: string) {
	return input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

function toSnake(kebab: string) {
	return kebab.replace(/-/g, '_');
}

function toPascal(kebab: string) {
	return kebab
		.split('-')
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join('');
}

function toCamel(kebab: string) {
	const pascal = toPascal(kebab);
	return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function toHuman(kebab: string) {
	return kebab
		.split('-')
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

function toSingularPascal(kebab: string) {
	const pascal = toPascal(kebab);
	// Naive singularization
	if (pascal.endsWith('ies')) return pascal.slice(0, -3) + 'y';
	if (pascal.endsWith('ses') || pascal.endsWith('xes')) return pascal.slice(0, -2);
	if (pascal.endsWith('s') && !pascal.endsWith('ss')) return pascal.slice(0, -1);
	return pascal;
}

function exitIfCancel<T>(value: T | symbol): T {
	if (isCancel(value)) {
		cancel('Operation cancelled.');
		process.exit(0);
	}
	return value;
}

type FieldSpec = { name: string; type: string };

function parseFieldsArg(raw: string): FieldSpec[] {
	return raw
		.split(',')
		.map((pair) => pair.trim())
		.filter(Boolean)
		.map((pair) => {
			const [name, type = 'text'] = pair.split(':');
			return { name: name.trim(), type: type.trim() };
		});
}

// ── Templates ──────────────────────────────────────────────────────────

function generateFrontendResource(opts: {
	name: string;
	table: string;
	fields: FieldSpec[];
	softDeletes: boolean;
	groupKey: string;
	backendModule: string;
}) {
	const { name, table, fields, softDeletes, groupKey, backendModule } = opts;
	const snake = toSnake(name);
	const camel = toCamel(name);
	const singular = toSingularPascal(name);

	const fieldDefs = fields
		.map((f) => {
			const lines = [
				`\t\tdefineField({`,
				`\t\t\ttype: '${f.type}',`,
				`\t\t\tattribute: '${f.name}',`,
				`\t\t\tlabelKey: 'admin.resources.${snake}.fields.${f.name}',`,
				...(f.type === 'text' ? [`\t\t\tsortable: true,`, `\t\t\tsearchable: true,`] : []),
				`\t\t\tshowOnIndex: true,`,
				`\t\t\tshowOnDetail: true,`,
				`\t\t\tshowOnForm: true`,
				`\t\t})`
			];
			return lines.join('\n');
		})
		.join(',\n');

	const systemFields = [
		`\t\tdefineField({`,
		`\t\t\ttype: 'date',`,
		`\t\t\tattribute: 'createdAt',`,
		`\t\t\tlabelKey: 'admin.resources.fields.created_at',`,
		`\t\t\tshowOnIndex: false,`,
		`\t\t\tshowOnDetail: true,`,
		`\t\t\tshowOnForm: false`,
		`\t\t}),`,
		`\t\tdefineField({`,
		`\t\t\ttype: 'datetime',`,
		`\t\t\tattribute: 'updatedAt',`,
		`\t\t\tlabelKey: 'admin.resources.fields.updated_at',`,
		`\t\t\tshowOnIndex: false,`,
		`\t\t\tshowOnDetail: true,`,
		`\t\t\tshowOnForm: false`,
		`\t\t})`
	].join('\n');

	const firstTextField = fields.find((f) => f.type === 'text');
	const titleAttr = firstTextField?.name ?? '_id';
	const titleFn =
		titleAttr === '_id'
			? `(record) => String(record._id)`
			: `(record) => String(record.${titleAttr} ?? '')`;

	const searchFields = fields
		.filter((f) => f.type === 'text' || f.type === 'email')
		.map((f) => `'${f.name}'`);

	const sortFieldNames = fields
		.filter((f) => f.type === 'text' || f.type === 'number')
		.map((f) => `'${f.name}'`);
	sortFieldNames.push(`'createdAt'`);

	const overviewFields = fields.map((f) => `'${f.name}'`).join(', ');

	return `import DatabaseIcon from '@lucide/svelte/icons/database'; // CUSTOMIZE: choose an appropriate icon
import { api } from '$lib/convex/_generated/api';
import { defineField, defineFilter, defineMetric, defineResource, defineResourceModule } from '../builders';
import type { ResourceRuntime } from '../types';

export const ${camel}Resource = defineResource({
	name: '${name}',
	table: '${table}',
	groupKey: '${groupKey}',
	navTitleKey: 'admin.resources.${snake}.nav_title',
	icon: DatabaseIcon, // CUSTOMIZE: choose an appropriate icon
	title: ${titleFn},
	subtitle: () => '',
	search: [${searchFields.join(', ')}],
	sortFields: [${sortFieldNames.join(', ')}],
	perPageOptions: [10, 20, 50],${softDeletes ? '\n\tsoftDeletes: true,' : ''}
	badgeQuery: {
		trashed: 'without'
	},
	clickAction: 'preview',
	canCreate: (user) => user.role === 'admin',
	canUpdate: (user) => user.role === 'admin',
	canDelete: (user) => user.role === 'admin',
	fields: [
${fieldDefs},
${systemFields}
	],
	filters: [
		defineFilter({
			key: 'createdRange',
			labelKey: 'admin.resources.filters.created_range',
			type: 'date-range',
			urlKey: 'createdRange',
			defaultValue: '',
			options: []
		})
	],
	metrics: [
		defineMetric({ key: 'total', type: 'value', labelKey: 'admin.resources.${snake}.metrics.total' })
	],
	fieldGroups: [
		{
			key: 'overview',
			labelKey: 'admin.resources.groups.overview',
			contexts: ['form', 'detail', 'preview'],
			fields: [${overviewFields}]
		},
		{
			key: 'system',
			labelKey: 'admin.resources.groups.system',
			contexts: ['detail'],
			fields: ['createdAt', 'updatedAt']
		}
	]
});

export const ${camel}Runtime: ResourceRuntime = {
	list: api.adminFramework.resources.${backendModule}.list${singular}s,
	count: api.adminFramework.resources.${backendModule}.count${singular}s,
	resolveLastPage: api.adminFramework.resources.${backendModule}.resolve${singular}sLastPage,
	getById: api.adminFramework.resources.${backendModule}.get${singular}ById,
	create: api.adminFramework.resources.${backendModule}.create${singular},
	update: api.adminFramework.resources.${backendModule}.update${singular},
	delete: api.adminFramework.resources.${backendModule}.delete${singular},
	restore: api.adminFramework.resources.${backendModule}.restore${singular},
	forceDelete: api.adminFramework.resources.${backendModule}.forceDelete${singular},
	replicate: api.adminFramework.resources.${backendModule}.replicate${singular},
	runAction: api.adminFramework.resources.${backendModule}.run${singular}Action,
	getMetrics: api.adminFramework.resources.${backendModule}.get${singular}Metrics
};

export default defineResourceModule({
	resource: ${camel}Resource,
	runtime: ${camel}Runtime
});
`;
}

function generateBackendResource(opts: {
	name: string;
	table: string;
	fields: FieldSpec[];
	softDeletes: boolean;
}) {
	const { name, table, fields, softDeletes } = opts;
	const singular = toSingularPascal(name);
	const singularLower = singular.toLowerCase();

	const docType = `${singular}Doc`;
	const docFields = [
		`\t_id: string;`,
		`\t_creationTime: number;`,
		...fields.map((f) => {
			const tsType = f.type === 'number' ? 'number' : f.type === 'boolean' ? 'boolean' : 'string';
			return `\t${f.name}: ${tsType};`;
		}),
		...(softDeletes ? [`\tisDeleted?: boolean;`, `\tdeletedAt?: number;`] : []),
		`\tcreatedAt: number;`,
		`\tupdatedAt: number;`
	].join('\n');

	const fieldPolicies = fields.map((f) => `\t{ attribute: '${f.name}' }`).join(',\n');

	const createValidatorFields = fields
		.map((f) => {
			const vType =
				f.type === 'number' ? 'v.number()' : f.type === 'boolean' ? 'v.boolean()' : 'v.string()';
			return `\t${f.name}: ${vType}`;
		})
		.join(',\n');

	const updateValidatorFields = fields
		.map((f) => {
			const vType =
				f.type === 'number' ? 'v.number()' : f.type === 'boolean' ? 'v.boolean()' : 'v.string()';
			return `\t${f.name}: v.optional(${vType})`;
		})
		.join(',\n');

	const firstTextField = fields.find((f) => f.type === 'text');
	const primarySortField = firstTextField?.name ?? 'createdAt';
	const indexName = `by_${primarySortField}`;

	const searchableValues = fields
		.filter((f) => f.type === 'text' || f.type === 'email')
		.map((f) => `item.${f.name}`);
	const searchableValuesStr =
		searchableValues.length > 0 ? searchableValues.join(', ') : `String(item._id)`;

	const sortMapEntries = fields
		.filter((f) => f.type === 'text' || f.type === 'number')
		.map((f) => `\t\t\t\t${f.name}: (item) => item.${f.name}`);
	sortMapEntries.push(`\t\t\t\tcreatedAt: (item) => item.createdAt`);

	const createInsertFields = fields.map((f) => `\t\t\t${f.name}: args.${f.name}`).join(',\n');

	const updatePatchFields = fields
		.map((f) => `\t\t\t${f.name}: args.values.${f.name} ?? ${singularLower}.${f.name}`)
		.join(',\n');

	const replicateFields = fields
		.map((f) => {
			if (f.type === 'text' && f === firstTextField) {
				return `\t\t\t${f.name}: \`\${${singularLower}.${f.name}} Copy\``;
			}
			return `\t\t\t${f.name}: ${singularLower}.${f.name}`;
		})
		.join(',\n');

	const validateChecks = fields
		.filter((f) => f.type === 'text' || f.type === 'email')
		.map(
			(f) =>
				`\tif (typeof values.${f.name} === 'string' && values.${f.name}.trim().length === 0) {\n\t\tfieldErrors.${f.name} = 'admin.resources.form.required';\n\t}`
		)
		.join('\n');

	const softDeleteFilter = softDeletes
		? `
	if (args.trashed === 'only') {
		return items.filter((item) => item.isDeleted);
	}
	if (args.trashed !== 'with') {
		items = items.filter((item) => !item.isDeleted);
	}`
		: '';

	const softDeleteListCheck = softDeletes
		? `
		// Apply soft-delete filter for indexed path
		// CUSTOMIZE: add proper index filtering for trashed records`
		: '';

	return `import { v } from 'convex/values';
import { permissionMutation, permissionQuery, assertPermission } from '../access';
import {
	countArgsValidator,
	listArgsValidator,
	resolveLastPage,
	resolveLastPageArgsValidator,
	resolveLastPageForPaginatedQuery,
	countPaginatedQuery,
	runPaginatedListQuery,
	runResourceListQuery
} from '../utils/resource_query';
import { notFoundError, validationError } from '../utils/errors';
import {
	applyFieldVisibility,
	applyFieldVisibilityList,
	type FieldPolicy
} from '../utils/visibility';
import { assertResourceCrudAllowed } from '../utils/resource_guards';
import { getResourceSearchIndexConfig } from '../utils/search_index';

type ${docType} = {
${docFields}
};

const ${singularLower}FieldPolicies: FieldPolicy<${docType}>[] = [
${fieldPolicies}
];

const ${singularLower}SearchIndex = getResourceSearchIndexConfig('${name}');

function matches${singular}Filters(item: { createdAt: number }, filters: Record<string, string>) {
	// CUSTOMIZE: add resource-specific filter logic here
	const createdRange = filters.createdRange;
	if (!createdRange || !createdRange.includes('..')) return true;
	const [startDate, endDate] = createdRange.split('..');
	const start = startDate ? new Date(startDate).getTime() : Number.NaN;
	const end = endDate ? new Date(endDate).getTime() : Number.NaN;
	if (!Number.isFinite(start) || !Number.isFinite(end)) return true;
	const endOfDay = end + 86_399_999;
	return item.createdAt >= start && item.createdAt <= endOfDay;
}

// ── List ───────────────────────────────────────────────────────────────

export const list${singular}s = permissionQuery({
	args: listArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const search = args.search?.trim();
		const hasCreatedRange = Boolean(args.filters?.createdRange);
		const supportsIndexedSort = !args.sortBy || args.sortBy.field === '${primarySortField}';

		if (!search && !hasCreatedRange && supportsIndexedSort) {${softDeleteListCheck}
			const paginated = await runPaginatedListQuery({
				query: ctx.db.query('${table}').withIndex('${indexName}'),
				cursor: args.cursor,
				numItems: args.numItems,
				order: args.sortBy?.direction === 'desc' ? 'desc' : 'asc'
			});
			return {
				items: applyFieldVisibilityList({
					items: paginated.items as ${docType}[],
					user: ctx.user,
					policies: ${singularLower}FieldPolicies
				}),
				continueCursor: paginated.continueCursor,
				isDone: paginated.isDone
			};
		}

		if (search && !hasCreatedRange && !args.sortBy) {
			const paginated = await runPaginatedListQuery({
				query: ctx.db
					.query('${table}')
					.withSearchIndex(${singularLower}SearchIndex.indexName, (q) =>
						q.search(${singularLower}SearchIndex.searchField, search)
					),
				cursor: args.cursor,
				numItems: args.numItems
			});
			return {
				items: applyFieldVisibilityList({
					items: paginated.items as ${docType}[],
					user: ctx.user,
					policies: ${singularLower}FieldPolicies
				}),
				continueCursor: paginated.continueCursor,
				isDone: paginated.isDone
			};
		}

		const all = await ctx.db.query('${table}').collect();
		const result = runResourceListQuery({
			items: all,
			cursor: args.cursor,
			numItems: args.numItems,
			search,
			sortBy: args.sortBy,
			sortMap: {
${sortMapEntries.join(',\n')}
			},
			searchableValues: (item) => [${searchableValuesStr}],
			applyFilters: (item) => matches${singular}Filters(item, args.filters ?? {})
		});
		return {
			items: applyFieldVisibilityList({
				items: result.items as ${docType}[],
				user: ctx.user,
				policies: ${singularLower}FieldPolicies
			}),
			continueCursor: result.continueCursor,
			isDone: result.isDone
		};
	}
});

// ── Count ──────────────────────────────────────────────────────────────

export const count${singular}s = permissionQuery({
	args: countArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const search = args.search?.trim();
		const hasCreatedRange = Boolean(args.filters?.createdRange);
		if (!search && !hasCreatedRange) {
			return countPaginatedQuery({
				createQuery: () => ctx.db.query('${table}').withIndex('${indexName}')
			});
		}
		if (search && !hasCreatedRange) {
			return countPaginatedQuery({
				createQuery: () =>
					ctx.db
						.query('${table}')
						.withSearchIndex(${singularLower}SearchIndex.indexName, (q) =>
							q.search(${singularLower}SearchIndex.searchField, search)
						)
			});
		}

		const all = await ctx.db.query('${table}').collect();
		return runResourceListQuery({
			items: all,
			numItems: all.length || 1,
			search,
			searchableValues: (item) => [${searchableValuesStr}],
			applyFilters: (item) => matches${singular}Filters(item, args.filters ?? {})
		}).totalCount;
	}
});

// ── Resolve Last Page ──────────────────────────────────────────────────

export const resolve${singular}sLastPage = permissionQuery({
	args: resolveLastPageArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const search = args.search?.trim();
		const hasCreatedRange = Boolean(args.filters?.createdRange);
		const supportsIndexedSort = !args.sortBy || args.sortBy.field === '${primarySortField}';
		if (!search && !hasCreatedRange && supportsIndexedSort) {
			return resolveLastPageForPaginatedQuery({
				createQuery: () => ctx.db.query('${table}').withIndex('${indexName}'),
				numItems: args.numItems,
				order: args.sortBy?.direction === 'desc' ? 'desc' : 'asc'
			});
		}
		if (search && !hasCreatedRange && !args.sortBy) {
			return resolveLastPageForPaginatedQuery({
				createQuery: () =>
					ctx.db
						.query('${table}')
						.withSearchIndex(${singularLower}SearchIndex.indexName, (q) =>
							q.search(${singularLower}SearchIndex.searchField, search)
						),
				numItems: args.numItems
			});
		}

		const all = await ctx.db.query('${table}').collect();
		const totalCount = runResourceListQuery({
			items: all,
			numItems: all.length || 1,
			search,
			searchableValues: (item) => [${searchableValuesStr}],
			applyFilters: (item) => matches${singular}Filters(item, args.filters ?? {})
		}).totalCount;
		return resolveLastPage({ totalCount, numItems: args.numItems });
	}
});

// ── Get by ID ──────────────────────────────────────────────────────────

export const get${singular}ById = permissionQuery({
	args: { id: v.id('${table}') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const doc = await ctx.db.get(args.id);
		if (!doc) notFoundError('${singular}');
		return applyFieldVisibility({
			item: doc as ${docType},
			user: ctx.user,
			policies: ${singularLower}FieldPolicies
		});
	}
});

// ── Validators ─────────────────────────────────────────────────────────

const ${singularLower}ValuesValidator = v.object({
${createValidatorFields}
});

const ${singularLower}UpdateValuesValidator = v.object({
${updateValidatorFields}
});

function validate${singular}Values(values: Record<string, unknown>) {
	const fieldErrors: Record<string, string> = {};
${validateChecks}
	if (Object.keys(fieldErrors).length > 0) {
		validationError(fieldErrors);
	}
}

// ── Create ─────────────────────────────────────────────────────────────

export const create${singular} = permissionMutation({
	args: ${singularLower}ValuesValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['create'] });
		assertResourceCrudAllowed({
			resourceName: '${name}',
			operation: 'create',
			user: ctx.user
		});
		validate${singular}Values(args);
		const now = Date.now();
		const id = await ctx.db.insert('${table}', {
${createInsertFields},
			createdAt: now,
			updatedAt: now
		});
		return { id };
	}
});

// ── Update ─────────────────────────────────────────────────────────────

export const update${singular} = permissionMutation({
	args: { id: v.id('${table}'), values: ${singularLower}UpdateValuesValidator },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['update'] });
		const ${singularLower} = await ctx.db.get(args.id);
		if (!${singularLower}) notFoundError('${singular}');
		assertResourceCrudAllowed({
			resourceName: '${name}',
			operation: 'update',
			user: ctx.user,
			record: ${singularLower} as Record<string, unknown>
		});
		const nextValues = {
${updatePatchFields}
		};
		validate${singular}Values(nextValues);
		await ctx.db.patch(args.id, {
			...nextValues,
			updatedAt: Date.now()
		});
		return { id: args.id };
	}
});

// ── Delete ─────────────────────────────────────────────────────────────

export const delete${singular} = permissionMutation({
	args: { id: v.id('${table}') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['delete'] });
		const ${singularLower} = await ctx.db.get(args.id);
		if (!${singularLower}) notFoundError('${singular}');
		assertResourceCrudAllowed({
			resourceName: '${name}',
			operation: 'delete',
			user: ctx.user,
			record: ${singularLower} as Record<string, unknown>
		});
		${
			softDeletes
				? `await ctx.db.patch(args.id, { isDeleted: true, deletedAt: Date.now() });`
				: `// CUSTOMIZE: cascade-delete related records if needed\n\t\tawait ctx.db.delete(args.id);`
		}
		return { id: args.id };
	}
});

// ── Restore ────────────────────────────────────────────────────────────

export const restore${singular} = permissionMutation({
	args: { id: v.id('${table}') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['update'] });
		assertResourceCrudAllowed({
			resourceName: '${name}',
			operation: 'update',
			user: ctx.user
		});
		${
			softDeletes
				? `const ${singularLower} = await ctx.db.get(args.id);\n\t\tif (!${singularLower}) notFoundError('${singular}');\n\t\tawait ctx.db.patch(args.id, { isDeleted: false, deletedAt: undefined });`
				: `// No soft-deletes — restore is a no-op`
		}
		return { id: args.id };
	}
});

// ── Force Delete ───────────────────────────────────────────────────────

export const forceDelete${singular} = permissionMutation({
	args: { id: v.id('${table}') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['delete'] });
		const ${singularLower} = await ctx.db.get(args.id);
		if (!${singularLower}) notFoundError('${singular}');
		assertResourceCrudAllowed({
			resourceName: '${name}',
			operation: 'delete',
			user: ctx.user,
			record: ${singularLower} as Record<string, unknown>
		});
		// CUSTOMIZE: cascade-delete related records if needed
		await ctx.db.delete(args.id);
		return { id: args.id };
	}
});

// ── Replicate ──────────────────────────────────────────────────────────

export const replicate${singular} = permissionMutation({
	args: { id: v.id('${table}') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['replicate'] });
		const ${singularLower} = await ctx.db.get(args.id);
		if (!${singularLower}) notFoundError('${singular}');
		assertResourceCrudAllowed({
			resourceName: '${name}',
			operation: 'update',
			user: ctx.user,
			record: ${singularLower} as Record<string, unknown>
		});
		const id = await ctx.db.insert('${table}', {
${replicateFields},
			createdAt: Date.now(),
			updatedAt: Date.now()
		});
		return { id };
	}
});

// ── Run Action ─────────────────────────────────────────────────────────

export const run${singular}Action = permissionMutation({
	args: {
		action: v.union(v.literal('noop')), // CUSTOMIZE: add action literals
		ids: v.array(v.id('${table}'))
	},
	handler: async (_ctx) => {
		return { type: 'message', text: 'admin.resources.toasts.action_success' };
	}
});

// ── Metrics ────────────────────────────────────────────────────────────

export const get${singular}Metrics = permissionQuery({
	args: {
		ranges: v.optional(v.record(v.string(), v.string()))
	},
	handler: async (ctx) => {
		assertPermission(ctx.user, { metric: ['read'] });
		const all = await ctx.db.query('${table}').collect();
		const total = all.length;
		return {
			cards: [{ key: 'total', type: 'value', value: total }]
		};
	}
});
`;
}

// ── i18n helpers ───────────────────────────────────────────────────────

function readJsonFile(filePath: string): Record<string, any> {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath: string, data: Record<string, any>) {
	fs.writeFileSync(filePath, JSON.stringify(data, null, '\t') + '\n', 'utf8');
}

function deepSet(obj: Record<string, any>, keys: string[], value: any) {
	let current = obj;
	for (let i = 0; i < keys.length - 1; i++) {
		const key = keys[i];
		if (!current[key] || typeof current[key] !== 'object') {
			current[key] = {};
		}
		current = current[key];
	}
	current[keys[keys.length - 1]] = value;
}

function appendI18nKeys(opts: { snake: string; humanName: string; fields: FieldSpec[] }) {
	const { snake, humanName, fields } = opts;

	for (const locale of LOCALES) {
		const filePath = path.join(I18N_DIR, `${locale}.json`);
		const data = readJsonFile(filePath);

		if (!data.admin) data.admin = {};
		if (!data.admin.resources) data.admin.resources = {};

		const isEnglish = locale === 'en';

		const fieldEntries: Record<string, string> = {};
		for (const f of fields) {
			fieldEntries[f.name] = isEnglish
				? toHuman(f.name.replace(/([A-Z])/g, '-$1').toLowerCase())
				: '';
		}

		const resourceBlock: Record<string, any> = {
			fields: fieldEntries,
			metrics: {
				total: isEnglish ? `Total ${humanName}` : ''
			},
			nav_title: isEnglish ? humanName : ''
		};

		data.admin.resources[snake] = resourceBlock;

		writeJsonFile(filePath, data);
	}
}

// ── search_index.ts update ─────────────────────────────────────────────

function appendSearchIndex(opts: { name: string; table: string; searchField: string }) {
	let content = fs.readFileSync(SEARCH_INDEX_PATH, 'utf8');

	const entry = `\t'${opts.name}': {
\t\tresourceName: '${opts.name}',
\t\ttable: '${opts.table}',
\t\tindexName: 'search_${opts.searchField}',
\t\tsearchField: '${opts.searchField}'
\t}`;

	// Insert before the closing `} as const`
	const closingPattern = /\n} as const/;
	if (!closingPattern.test(content)) {
		console.warn('Could not find closing pattern in search_index.ts — manual update needed.');
		return false;
	}

	content = content.replace(closingPattern, `,\n${entry}\n} as const`);
	fs.writeFileSync(SEARCH_INDEX_PATH, content, 'utf8');
	return true;
}

// ── resource_guards.ts update ──────────────────────────────────────────

function appendResourceGuard(name: string) {
	let content = fs.readFileSync(GUARDS_PATH, 'utf8');

	if (content.includes(`'${name}'`)) return true; // already present

	// Find the closing `};` of the resourceCrudGuards object and insert before it.
	// We match the last `}` followed by `\n};` — the last entry's closing brace.
	const closingPattern = /(\})\n\};/;
	const match = content.match(closingPattern);
	if (!match || match.index === undefined) {
		console.warn(
			'Could not find resourceCrudGuards closing in resource_guards.ts — manual update needed.'
		);
		return false;
	}

	const insertPos = match.index + match[1].length;
	const newEntry = `,\n\t'${name}': {}`;
	content = content.slice(0, insertPos) + newEntry + content.slice(insertPos);
	fs.writeFileSync(GUARDS_PATH, content, 'utf8');
	return true;
}

// ── CLI arg parsing ────────────────────────────────────────────────────

function parseCliArgs() {
	const args = process.argv.slice(2);
	const flags: Record<string, string | boolean> = {};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--soft-deletes') {
			flags.softDeletes = true;
		} else if (arg.startsWith('--') && i + 1 < args.length) {
			const key = arg.slice(2);
			flags[key] = args[++i];
		}
	}
	return flags;
}

function validateCliArgs(flags: Record<string, string | boolean>) {
	const errors: string[] = [];
	if (!flags.name || typeof flags.name !== 'string') errors.push('--name is required');
	if (!flags.table || typeof flags.table !== 'string') errors.push('--table is required');
	if (!flags.fields || typeof flags.fields !== 'string') errors.push('--fields is required');

	if (typeof flags.fields === 'string') {
		const parsed = parseFieldsArg(flags.fields);
		for (const f of parsed) {
			if (!f.name) errors.push(`Field missing name in "${flags.fields}"`);
			if (!(FIELD_TYPES as readonly string[]).includes(f.type)) {
				errors.push(`Unknown field type "${f.type}". Valid: ${FIELD_TYPES.join(', ')}`);
			}
		}
	}

	return errors;
}

// ── Generation logic ───────────────────────────────────────────────────

type GenerateInput = {
	name: string;
	table: string;
	fields: FieldSpec[];
	softDeletes: boolean;
	groupKey: string;
};

function runGeneration(input: GenerateInput, interactive: boolean) {
	const { name, table, fields, softDeletes, groupKey } = input;
	const snake = toSnake(name);
	const backendModule = toCamel(name);

	const frontendPath = path.join(FRONTEND_DIR, `${name}.ts`);
	const backendPath = path.join(BACKEND_DIR, `${backendModule}.ts`);

	// Check for conflicts
	if (fs.existsSync(frontendPath)) {
		const msg = `Frontend file already exists: ${frontendPath}`;
		if (interactive) {
			cancel(msg);
			process.exit(1);
		} else {
			console.error(`Error: ${msg}`);
			process.exit(1);
		}
	}
	if (fs.existsSync(backendPath)) {
		const msg = `Backend file already exists: ${backendPath}`;
		if (interactive) {
			cancel(msg);
			process.exit(1);
		} else {
			console.error(`Error: ${msg}`);
			process.exit(1);
		}
	}

	// 1. Generate frontend resource
	const frontendContent = generateFrontendResource({
		name,
		table,
		fields,
		softDeletes,
		groupKey,
		backendModule
	});
	fs.writeFileSync(frontendPath, frontendContent, 'utf8');

	// 2. Generate backend resource
	const backendContent = generateBackendResource({ name, table, fields, softDeletes });
	fs.writeFileSync(backendPath, backendContent, 'utf8');

	// 3. Append i18n keys
	const firstTextField = fields.find((f) => f.type === 'text');
	appendI18nKeys({ snake, humanName: toHuman(name), fields });

	// 4. Update search_index.ts
	const searchField = firstTextField?.name ?? fields[0].name;
	const searchIndexOk = appendSearchIndex({ name, table, searchField });

	// 5. Update resource_guards.ts
	const guardsOk = appendResourceGuard(name);

	// Summary
	const relFrontend = path.relative(ROOT, frontendPath);
	const relBackend = path.relative(ROOT, backendPath);
	const primaryIndex = `by_${firstTextField?.name ?? 'createdAt'}`;

	return { relFrontend, relBackend, searchField, primaryIndex, searchIndexOk, guardsOk };
}

// ── Main ───────────────────────────────────────────────────────────────

const cliFlags = parseCliArgs();
const isNonInteractive = Boolean(cliFlags.name && cliFlags.table && cliFlags.fields);

if (isNonInteractive) {
	// ── Non-interactive mode (for LLMs / CI) ───────────────────────────
	// Usage: bun scripts/admin/generate-resource.ts \
	//   --name blog-posts --table blogPosts \
	//   --fields "title:text,status:select" \
	//   [--soft-deletes] [--group admin.resources.groups.content]

	const errors = validateCliArgs(cliFlags);
	if (errors.length > 0) {
		console.error('Validation errors:');
		for (const e of errors) console.error(`  - ${e}`);
		process.exit(1);
	}

	const name = toKebab(cliFlags.name as string);
	const table = (cliFlags.table as string).trim();
	const fields = parseFieldsArg(cliFlags.fields as string);
	const softDeletes = Boolean(cliFlags.softDeletes);
	const groupKey =
		typeof cliFlags.group === 'string' ? cliFlags.group.trim() : 'admin.resources.groups.demo_data';

	const result = runGeneration({ name, table, fields, softDeletes, groupKey }, false);

	console.log(`Created: ${result.relFrontend}`);
	console.log(`Created: ${result.relBackend}`);
	console.log(`Updated: src/i18n/{${LOCALES.join(',')}}.json`);
	if (result.searchIndexOk) console.log('Updated: search_index.ts');
	if (result.guardsOk) console.log('Updated: resource_guards.ts');
	console.log('');
	console.log('Next steps:');
	console.log(`  1. Add "${table}" table to src/lib/convex/schema.ts`);
	console.log(
		`     (include search index: search_${result.searchField}, and index: ${result.primaryIndex})`
	);
	console.log('  2. Run: bun run generate');
	console.log('  3. Customize CUSTOMIZE-marked sections in both files');
	console.log(`  4. Fill in non-English translations in src/i18n/{de,es,fr}.json`);
	console.log(`  5. Run: bun scripts/static-checks.ts ${result.relFrontend} ${result.relBackend}`);
} else {
	// ── Interactive mode (for humans) ──────────────────────────────────

	intro('Admin Resource Generator');

	const answers = await group(
		{
			name: () =>
				text({
					message: 'Resource name (kebab-case, e.g. "blog-posts"):',
					placeholder: 'my-resource',
					validate: (v) => {
						const kebab = toKebab(v);
						if (kebab.length === 0) return 'Name is required';
						if (fs.existsSync(path.join(FRONTEND_DIR, `${kebab}.ts`)))
							return `Resource file already exists: ${kebab}.ts`;
						return undefined;
					}
				}),
			table: ({ results }) =>
				text({
					message: 'Convex table name:',
					placeholder: toCamel(toKebab(results.name ?? 'myResource')),
					validate: (v) => {
						if (!v || v.trim().length === 0) return 'Table name is required';
						return undefined;
					}
				}),
			fields: () =>
				text({
					message: 'Fields (comma-separated name:type pairs):',
					placeholder: 'name:text,email:email,status:select',
					initialValue: 'name:text',
					validate: (v) => {
						if (!v || v.trim().length === 0) return 'At least one field is required';
						const parsed = parseFieldsArg(v);
						for (const f of parsed) {
							if (!f.name) return 'Each field needs a name';
							if (!(FIELD_TYPES as readonly string[]).includes(f.type)) {
								return `Unknown field type "${f.type}". Valid: ${FIELD_TYPES.join(', ')}`;
							}
						}
						return undefined;
					}
				}),
			softDeletes: () =>
				confirm({
					message: 'Enable soft deletes?',
					initialValue: false
				}),
			groupKey: () =>
				text({
					message: 'Group key (i18n key for sidebar group):',
					initialValue: 'admin.resources.groups.demo_data',
					validate: (v) => {
						if (!v || v.trim().length === 0) return 'Group key is required';
						return undefined;
					}
				})
		},
		{
			onCancel: () => {
				cancel('Operation cancelled.');
				process.exit(0);
			}
		}
	);

	const name = toKebab(answers.name);
	const table = answers.table.trim();
	const fields = parseFieldsArg(answers.fields);
	const softDeletes = answers.softDeletes;
	const groupKey = answers.groupKey.trim();

	const s = spinner();
	s.start('Generating files...');

	const result = runGeneration({ name, table, fields, softDeletes, groupKey }, true);

	s.stop('Files generated!');

	const createdLines = [
		`Created: ${result.relFrontend}`,
		`Created: ${result.relBackend}`,
		`Updated: src/i18n/{${LOCALES.join(',')}}.json`
	];
	if (result.searchIndexOk) createdLines.push('Updated: search_index.ts');
	if (result.guardsOk) createdLines.push('Updated: resource_guards.ts');

	note(createdLines.join('\n'), 'Generated files');

	note(
		[
			`1. Add "${table}" table to src/lib/convex/schema.ts`,
			`   (include search index: search_${result.searchField}, and index: ${result.primaryIndex})`,
			'2. Run: bun run generate',
			'3. Customize CUSTOMIZE-marked sections in both files',
			`4. Fill in non-English translations in src/i18n/{de,es,fr}.json`,
			`5. Run: bun scripts/static-checks.ts ${result.relFrontend} ${result.relBackend}`
		].join('\n'),
		'Next steps'
	);

	outro('Done! Auto-discovery will pick up the new resource automatically.');
}
