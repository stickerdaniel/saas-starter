import type {
	ActionDefinition,
	FieldDefinition,
	FilterDefinition,
	LensDefinition,
	MetricDefinition,
	ResourceDefinition,
	ResourceModule
} from './types';

export function defineResource<TTable extends string>(
	resource: ResourceDefinition<TTable>
): ResourceDefinition<TTable> {
	return resource;
}

export function defineField<TTable extends string>(
	field: FieldDefinition<TTable>
): FieldDefinition<TTable> {
	return field;
}

export function defineAction(action: ActionDefinition): ActionDefinition {
	return action;
}

export function defineDestructiveAction(
	action: Omit<ActionDefinition, 'destructive' | 'withoutConfirmation'>
): ActionDefinition {
	return {
		...action,
		destructive: true,
		withoutConfirmation: false,
		confirmTextKey: action.confirmTextKey ?? action.nameKey
	};
}

export function defineFilter(filter: FilterDefinition): FilterDefinition {
	return filter;
}

export function defineLens<TTable extends string>(
	lens: LensDefinition<TTable>
): LensDefinition<TTable> {
	return lens;
}

export function defineMetric(metric: MetricDefinition): MetricDefinition {
	return metric;
}

export function defineResourceModule(mod: ResourceModule): ResourceModule {
	return mod;
}
