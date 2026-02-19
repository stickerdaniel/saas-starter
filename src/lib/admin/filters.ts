import type { FieldDefinition, FilterableConfig, FilterDefinition, FilterOption } from './types';

const ALL_OPTION: FilterOption = { value: 'all', labelKey: 'admin.resources.filters.all' };
const BOOLEAN_OPTIONS: FilterOption[] = [
	ALL_OPTION,
	{ value: 'yes', labelKey: 'admin.resources.filters.yes' },
	{ value: 'no', labelKey: 'admin.resources.filters.no' }
];

function resolveFilterableConfig(
	field: FieldDefinition
): (FilterableConfig & { _enabled: true }) | null {
	if (!field.filterable) return null;
	const config = typeof field.filterable === 'object' ? field.filterable : {};
	return { _enabled: true, ...config };
}

function buildSelectFilter(
	field: FieldDefinition,
	config: FilterableConfig
): FilterDefinition | null {
	const options = config.options ?? field.options;
	if (!options || options.length === 0) return null;

	return {
		key: config.key ?? field.attribute,
		labelKey: config.labelKey ?? field.labelKey,
		type: 'select',
		urlKey: config.urlKey ?? field.attribute,
		defaultValue: config.defaultValue ?? 'all',
		options: [ALL_OPTION, ...options]
	};
}

function buildBooleanFilter(field: FieldDefinition, config: FilterableConfig): FilterDefinition {
	return {
		key: config.key ?? field.attribute,
		labelKey: config.labelKey ?? field.labelKey,
		type: 'boolean',
		urlKey: config.urlKey ?? field.attribute,
		defaultValue: config.defaultValue ?? 'all',
		options: config.options ?? BOOLEAN_OPTIONS
	};
}

function buildDateRangeFilter(field: FieldDefinition, config: FilterableConfig): FilterDefinition {
	return {
		key: config.key ?? field.attribute,
		labelKey: config.labelKey ?? field.labelKey,
		type: 'date-range',
		urlKey: config.urlKey ?? field.attribute,
		defaultValue: config.defaultValue ?? ''
	};
}

function resolveFilterType(
	field: FieldDefinition,
	config: FilterableConfig
): 'select' | 'boolean' | 'date-range' | null {
	if (config.type) return config.type;
	switch (field.type) {
		case 'select':
		case 'badge':
			return 'select';
		case 'boolean':
			return 'boolean';
		case 'date':
		case 'datetime':
			return 'date-range';
		case 'belongsTo':
			return config.options ? 'select' : null;
		default:
			return null;
	}
}

export function resolveFieldFilter(field: FieldDefinition): FilterDefinition | null {
	const config = resolveFilterableConfig(field);
	if (!config) return null;

	const filterType = resolveFilterType(field, config);
	if (!filterType) return null;

	switch (filterType) {
		case 'select':
			return buildSelectFilter(field, config);
		case 'boolean':
			return buildBooleanFilter(field, config);
		case 'date-range':
			return buildDateRangeFilter(field, config);
	}
}

export function resolveFieldFilters(fields: FieldDefinition[]): FilterDefinition[] {
	const filters: FilterDefinition[] = [];
	for (const field of fields) {
		const filter = resolveFieldFilter(field);
		if (filter) filters.push(filter);
	}
	return filters;
}
