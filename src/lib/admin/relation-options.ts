import type { ConvexClient } from 'convex/browser';
import type { FieldDefinition } from './types';
import type { ResourceRuntime } from './types';
import { mapMorphOptions, type RelationOption } from './form-utils';

type RelationOptionMap = Record<string, RelationOption[]>;

function toRelationOptions(options: unknown): RelationOption[] {
	if (!Array.isArray(options)) return [];
	return options
		.filter((option) => option && typeof option === 'object')
		.map((option) => {
			const record = option as Record<string, unknown>;
			return {
				value: String(record.value ?? ''),
				label: String(record.label ?? '')
			};
		})
		.filter((option) => option.value.length > 0);
}

export async function loadRelationOptionsForFields(args: {
	fields: FieldDefinition<any>[];
	runtime: ResourceRuntime;
	client: ConvexClient;
}): Promise<RelationOptionMap> {
	const { fields, runtime, client } = args;
	if (!runtime.listRelationOptions) return {};

	const nextOptions: RelationOptionMap = {};

	for (const field of fields) {
		if (field.type === 'morphTo') {
			const targets = field.morphTo?.targets ?? [];
			if (targets.length === 0) continue;
			const collected: RelationOption[] = [];
			for (const target of targets) {
				const relationQuery =
					runtime.listRelationOptions[target.resourceName] ??
					runtime.listRelationOptions[`${field.attribute}:${target.kind}`] ??
					runtime.listRelationOptions[target.kind];
				if (!relationQuery) continue;
				const rawOptions = await client.query(relationQuery, {} as never);
				collected.push(...mapMorphOptions(target.kind, toRelationOptions(rawOptions)));
			}
			nextOptions[field.attribute] = collected;
			continue;
		}

		if (!field.relation) continue;

		const relationQuery = runtime.listRelationOptions[field.attribute];
		if (!relationQuery) continue;
		const rawOptions = await client.query(relationQuery, {} as never);
		nextOptions[field.attribute] = toRelationOptions(rawOptions);
	}

	return nextOptions;
}
