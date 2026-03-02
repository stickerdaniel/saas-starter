import { safeParse } from 'valibot';
import type { BetterAuthUser } from '$lib/convex/admin/types';
import type { FieldDefinition } from './types';
import { isFieldDependencySatisfied, isFieldDisabled, isFieldVisible } from './visibility';

export type RelationOption = { value: string; label: string };

export function mapMorphOptions(target: string, options: RelationOption[]): RelationOption[] {
	return options.map((option) => ({
		value: `${target}:${option.value}`,
		label: option.label
	}));
}

export function getVisibleFormFields(args: {
	fields: FieldDefinition<any>[];
	values: Record<string, unknown>;
	user?: BetterAuthUser;
	record?: Record<string, unknown> | null;
}) {
	return args.fields.filter((field) => {
		if (field.showOnForm === false) return false;
		if (!isFieldVisible(field, { user: args.user, record: args.record })) return false;
		if (!isFieldDependencySatisfied(field, args.values)) return false;
		return true;
	});
}

export function normalizeFormValues(
	fields: FieldDefinition<any>[],
	values: Record<string, unknown>
) {
	const next: Record<string, unknown> = { ...values };
	for (const field of fields) {
		if (field.type === 'heading') continue;
		let current = next[field.attribute];
		if (field.type === 'number' || field.type === 'currency') {
			current = Number(current ?? 0);
		}
		if (field.type === 'boolean') {
			current = Boolean(current);
		}
		if (field.type === 'morphTo' && typeof current === 'string') {
			const [kind, id] = current.split(':');
			if (kind && id) {
				current = { kind, id };
			}
		}
		if (field.type === 'booleanGroup' && typeof current === 'string') {
			try {
				current = JSON.parse(current);
			} catch {
				/* keep as-is */
			}
		}
		if (field.type === 'keyValue' && typeof current === 'string') {
			try {
				current = JSON.parse(current);
			} catch {
				/* keep as-is */
			}
		}
		if (field.fillUsing) {
			current = field.fillUsing(current, next, field.attribute);
		}
		next[field.attribute] = current;
	}
	return next;
}

export function mapRecordToFormValues(
	fields: FieldDefinition<any>[],
	record: Record<string, unknown>
): Record<string, unknown> {
	return Object.fromEntries(
		fields
			.filter((f) => f.type !== 'heading')
			.map((field) => {
				if (field.type === 'manyToMany' || field.type === 'multiselect' || field.type === 'tag') {
					let relationValues: unknown[] = [];
					const fromAttribute = record[field.attribute];
					if (Array.isArray(fromAttribute)) {
						relationValues = fromAttribute;
					}
					const ids = relationValues
						.map((entry) => {
							if (typeof entry === 'string') return entry;
							if (!entry || typeof entry !== 'object') return null;
							const maybeId = (entry as Record<string, unknown>)._id;
							return typeof maybeId === 'string' ? maybeId : null;
						})
						.filter((entry): entry is string => Boolean(entry));
					return [field.attribute, ids];
				}

				if (field.type === 'morphTo') {
					const target = record[field.attribute];
					if (target && typeof target === 'object') {
						const morph = target as { kind?: unknown; id?: unknown };
						if (typeof morph.kind === 'string' && typeof morph.id === 'string') {
							return [field.attribute, `${morph.kind}:${morph.id}`];
						}
					}
					return [field.attribute, ''];
				}

				if (field.type === 'booleanGroup') {
					const raw = record[field.attribute];
					if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
						return [field.attribute, raw];
					}
					return [field.attribute, {}];
				}

				if (field.type === 'keyValue') {
					const raw = record[field.attribute];
					if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
						return [field.attribute, raw];
					}
					return [field.attribute, {}];
				}

				return [field.attribute, record[field.attribute] ?? ''];
			})
	);
}

export function validateFormValues(args: {
	fields: FieldDefinition<any>[];
	values: Record<string, unknown>;
	user?: BetterAuthUser;
	record?: Record<string, unknown> | null;
	isEdit: boolean;
	t: (key: string) => string;
}) {
	const nextErrors: Record<string, string> = {};

	for (const field of args.fields) {
		const value = args.values[field.attribute];
		if (!isFieldDependencySatisfied(field, args.values)) continue;
		if (!isFieldVisible(field, { user: args.user, record: args.record })) continue;
		if (
			isFieldDisabled(field, {
				user: args.user,
				record: args.record,
				isEdit: args.isEdit
			})
		) {
			continue;
		}

		if (field.type === 'heading') continue;
		if (
			field.required &&
			field.type !== 'boolean' &&
			field.type !== 'manyToMany' &&
			field.type !== 'tag' &&
			field.type !== 'booleanGroup' &&
			field.type !== 'multiselect' &&
			field.type !== 'keyValue'
		) {
			if (value === undefined || value === null || value === '') {
				nextErrors[field.attribute] = args.t('admin.resources.form.required');
				continue;
			}
		}

		if (field.rules) {
			const result = safeParse(field.rules, value);
			if (!result.success) {
				nextErrors[field.attribute] =
					result.issues[0]?.message ?? args.t('admin.resources.form.invalid');
			}
		}
	}

	return nextErrors;
}
