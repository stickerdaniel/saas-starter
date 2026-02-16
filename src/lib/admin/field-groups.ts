import type { FieldContext, FieldDefinition, ResourceDefinition } from './types';

export type ResolvedFieldGroup = {
	key: string;
	labelKey: string;
	fields: FieldDefinition<any>[];
};

export function resolveFieldGroups(args: {
	resource: ResourceDefinition<any>;
	context: FieldContext;
	fields: FieldDefinition<any>[];
}): ResolvedFieldGroup[] {
	const { resource, context, fields } = args;
	const configured = (resource.fieldGroups ?? []).filter(
		(group) => !group.contexts || group.contexts.includes(context)
	);

	if (configured.length === 0) {
		return [{ key: 'main', labelKey: 'admin.resources.groups.main', fields }];
	}

	const byAttribute = new Map(fields.map((field) => [field.attribute, field]));
	const grouped: ResolvedFieldGroup[] = configured
		.map((group) => ({
			key: group.key,
			labelKey: group.labelKey,
			fields: group.fields
				.map((attribute) => byAttribute.get(attribute))
				.filter((field): field is FieldDefinition<any> => Boolean(field))
		}))
		.filter((group) => group.fields.length > 0);

	const groupedAttributes = new Set(
		grouped.flatMap((group) => group.fields.map((field) => field.attribute))
	);
	const ungrouped = fields.filter((field) => !groupedAttributes.has(field.attribute));
	if (ungrouped.length > 0) {
		grouped.push({
			key: 'other',
			labelKey: 'admin.resources.groups.other',
			fields: ungrouped
		});
	}

	return grouped;
}
