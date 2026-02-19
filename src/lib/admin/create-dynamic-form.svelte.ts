import { SvelteSet } from 'svelte/reactivity';
import type { BetterAuthUser } from '$lib/convex/admin/types';
import type { FieldDefinition } from './types';
import {
	getVisibleFormFields,
	mapRecordToFormValues,
	normalizeFormValues,
	validateFormValues
} from './form-utils';

export type DynamicFormConfig = {
	fields: FieldDefinition<any>[];
	user?: BetterAuthUser;
	isEdit: boolean;
	t: (key: string) => string;
};

function getDefaultFieldValue(field: FieldDefinition<any>) {
	if (field.defaultValue !== undefined) return field.defaultValue;
	if (field.type === 'manyToMany' || field.type === 'multiselect') return [];
	if (field.type === 'boolean') return false;
	if (field.type === 'booleanGroup') return {};
	if (field.type === 'keyValue') return {};
	if (field.type === 'heading') return undefined;
	return '';
}

function isSameValue(left: unknown, right: unknown) {
	if (left === right) return true;
	if (typeof left === 'number' && typeof right === 'number') {
		return Number.isNaN(left) && Number.isNaN(right);
	}
	if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null) {
		return JSON.stringify(left) === JSON.stringify(right);
	}
	return false;
}

class DynamicFormState {
	fields: FieldDefinition<any>[];
	user?: BetterAuthUser;
	isEdit: boolean;
	t: (key: string) => string;

	values = $state<Record<string, unknown>>({});
	errors = $state<Record<string, string>>({});
	submitting = $state(false);
	hydrated = $state(false);
	dirtyFields = $state<SvelteSet<string>>(new SvelteSet());
	hydratedSnapshot = $state<Record<string, unknown>>({});

	constructor(config: DynamicFormConfig) {
		this.fields = config.fields;
		this.user = config.user;
		this.isEdit = config.isEdit;
		this.t = config.t;
		this.values = Object.fromEntries(
			this.fields.map((field) => [field.attribute, getDefaultFieldValue(field)])
		);
		this.hydrated = !config.isEdit;
	}

	setValue(attribute: string, value: unknown, trackDirty = true) {
		this.values = {
			...this.values,
			[attribute]: value
		};
		if (!trackDirty) return;
		const nextDirty = new SvelteSet(this.dirtyFields);
		if (isSameValue(value, this.hydratedSnapshot[attribute])) {
			nextDirty.delete(attribute);
		} else {
			nextDirty.add(attribute);
		}
		this.dirtyFields = nextDirty;
	}

	setErrors(next: Record<string, string>) {
		this.errors = next;
	}

	setSubmitting(next: boolean) {
		this.submitting = next;
	}

	markHydrated(next: boolean) {
		this.hydrated = next;
	}

	initializeFromRecord(record: Record<string, unknown>) {
		const mapped = mapRecordToFormValues(this.fields, record);
		this.values = mapped;
		this.hydratedSnapshot = { ...mapped };
		this.dirtyFields = new SvelteSet();
		this.hydrated = true;
	}

	projectRecord(record: Record<string, unknown>) {
		return mapRecordToFormValues(this.fields, record);
	}

	getChangedFields(record: Record<string, unknown>) {
		const projected = this.projectRecord(record);
		const changed: string[] = [];
		for (const field of this.fields) {
			const attribute = field.attribute;
			if (!isSameValue(projected[attribute], this.hydratedSnapshot[attribute])) {
				changed.push(attribute);
			}
		}
		return {
			changed,
			projected
		};
	}

	mergeNonDirty(record: Record<string, unknown>) {
		const projected = this.projectRecord(record);
		const nextValues = { ...this.values };
		const nextSnapshot = { ...this.hydratedSnapshot };
		let didChange = false;
		for (const field of this.fields) {
			const attribute = field.attribute;
			if (!this.dirtyFields.has(attribute)) {
				if (!isSameValue(nextValues[attribute], projected[attribute])) {
					nextValues[attribute] = projected[attribute];
					didChange = true;
				}
				if (!isSameValue(nextSnapshot[attribute], projected[attribute])) {
					nextSnapshot[attribute] = projected[attribute];
					didChange = true;
				}
			}
		}
		if (didChange) {
			this.values = nextValues;
			this.hydratedSnapshot = nextSnapshot;
		}
	}

	useRemoteValue(attribute: string, remoteValue: unknown) {
		this.values = {
			...this.values,
			[attribute]: remoteValue
		};
		this.hydratedSnapshot = {
			...this.hydratedSnapshot,
			[attribute]: remoteValue
		};
		const nextDirty = new SvelteSet(this.dirtyFields);
		nextDirty.delete(attribute);
		this.dirtyFields = nextDirty;
	}

	keepLocalValue(attribute: string, remoteValue: unknown) {
		this.hydratedSnapshot = {
			...this.hydratedSnapshot,
			[attribute]: remoteValue
		};
		const nextDirty = new SvelteSet(this.dirtyFields);
		if (isSameValue(this.values[attribute], remoteValue)) {
			nextDirty.delete(attribute);
		} else {
			nextDirty.add(attribute);
		}
		this.dirtyFields = nextDirty;
	}

	getVisibleFields(record?: Record<string, unknown> | null) {
		return getVisibleFormFields({
			fields: this.fields,
			values: this.values,
			user: this.user,
			record
		});
	}

	validate(record?: Record<string, unknown> | null) {
		const visibleFields = this.getVisibleFields(record);
		this.errors = validateFormValues({
			fields: visibleFields,
			values: this.values,
			user: this.user,
			record,
			isEdit: this.isEdit,
			t: this.t
		});
		return this.errors;
	}

	normalize(record?: Record<string, unknown> | null) {
		const visibleFields = this.getVisibleFields(record);
		return normalizeFormValues(visibleFields, this.values);
	}
}

export function createDynamicForm(config: DynamicFormConfig) {
	return new DynamicFormState(config);
}
