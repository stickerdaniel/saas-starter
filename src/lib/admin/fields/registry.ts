import type { Component } from 'svelte';
import type { FieldContext } from '$lib/admin/types';
import IndexCell from './index-cell.svelte';
import DetailValue from './detail-value.svelte';
import FormInput from './form-input.svelte';

type FieldComponentMap = Record<string, Record<FieldContext, Component<any>>>;

export const fieldComponentMap: FieldComponentMap = {
	text: {
		index: IndexCell,
		detail: DetailValue,
		form: FormInput,
		preview: DetailValue
	},
	textarea: {
		index: IndexCell,
		detail: DetailValue,
		form: FormInput,
		preview: DetailValue
	},
	number: {
		index: IndexCell,
		detail: DetailValue,
		form: FormInput,
		preview: DetailValue
	},
	boolean: {
		index: IndexCell,
		detail: DetailValue,
		form: FormInput,
		preview: DetailValue
	},
	select: {
		index: IndexCell,
		detail: DetailValue,
		form: FormInput,
		preview: DetailValue
	},
	email: {
		index: IndexCell,
		detail: DetailValue,
		form: FormInput,
		preview: DetailValue
	},
	badge: {
		index: IndexCell,
		detail: DetailValue,
		form: FormInput,
		preview: DetailValue
	},
	belongsTo: {
		index: IndexCell,
		detail: DetailValue,
		form: FormInput,
		preview: DetailValue
	},
	hasMany: {
		index: IndexCell,
		detail: DetailValue,
		form: FormInput,
		preview: DetailValue
	},
	manyToMany: {
		index: IndexCell,
		detail: DetailValue,
		form: FormInput,
		preview: DetailValue
	},
	morphTo: {
		index: IndexCell,
		detail: DetailValue,
		form: FormInput,
		preview: DetailValue
	},
	date: {
		index: IndexCell,
		detail: DetailValue,
		form: FormInput,
		preview: DetailValue
	},
	datetime: {
		index: IndexCell,
		detail: DetailValue,
		form: FormInput,
		preview: DetailValue
	},
	url: {
		index: IndexCell,
		detail: DetailValue,
		form: FormInput,
		preview: DetailValue
	},
	json: {
		index: IndexCell,
		detail: DetailValue,
		form: FormInput,
		preview: DetailValue
	}
};

export function getFieldComponent(fieldType: string, context: FieldContext) {
	const byType = fieldComponentMap[fieldType] ?? fieldComponentMap.text;
	return byType[context];
}
