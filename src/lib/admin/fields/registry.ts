import type { Component } from 'svelte';
import type { FieldContext } from '$lib/admin/types';
import IndexCell from './index-cell.svelte';
import DetailValue from './detail-value.svelte';
import FormInput from './form-input.svelte';
import FormFileUpload from './form-file-upload.svelte';
import FormHeading from './form-heading.svelte';
import FormKeyValue from './form-key-value.svelte';
import LazyFormJsonEditor from './lazy-form-json-editor.svelte';
import LazyDetailJsonViewer from './lazy-detail-json-viewer.svelte';
import LazyFormMarkdownEditor from './lazy-form-markdown-editor.svelte';
import LazyDetailMarkdownViewer from './lazy-detail-markdown-viewer.svelte';

type FieldComponentMap = Record<string, Record<FieldContext, Component<any>>>;

const standardEntry = {
	index: IndexCell,
	detail: DetailValue,
	form: FormInput,
	preview: DetailValue
};

export const fieldComponentMap: FieldComponentMap = {
	text: standardEntry,
	textarea: standardEntry,
	number: standardEntry,
	boolean: standardEntry,
	select: standardEntry,
	email: standardEntry,
	badge: standardEntry,
	belongsTo: standardEntry,
	hasMany: standardEntry,
	manyToMany: standardEntry,
	morphTo: standardEntry,
	date: standardEntry,
	datetime: standardEntry,
	url: standardEntry,
	password: standardEntry,
	color: standardEntry,
	slug: standardEntry,
	currency: standardEntry,
	hidden: standardEntry,
	booleanGroup: standardEntry,
	multiselect: standardEntry,
	status: {
		index: IndexCell,
		detail: DetailValue,
		form: FormInput,
		preview: DetailValue
	},
	avatar: {
		index: IndexCell,
		detail: DetailValue,
		form: FormFileUpload,
		preview: DetailValue
	},
	image: {
		index: IndexCell,
		detail: DetailValue,
		form: FormFileUpload,
		preview: DetailValue
	},
	file: {
		index: IndexCell,
		detail: DetailValue,
		form: FormFileUpload,
		preview: DetailValue
	},
	keyValue: {
		index: IndexCell,
		detail: DetailValue,
		form: FormKeyValue,
		preview: DetailValue
	},
	heading: {
		index: IndexCell,
		detail: DetailValue,
		form: FormHeading,
		preview: DetailValue
	},
	json: {
		index: IndexCell,
		detail: LazyDetailJsonViewer,
		form: LazyFormJsonEditor,
		preview: LazyDetailJsonViewer
	},
	code: {
		index: IndexCell,
		detail: LazyDetailJsonViewer,
		form: LazyFormJsonEditor,
		preview: LazyDetailJsonViewer
	},
	markdown: {
		index: IndexCell,
		detail: LazyDetailMarkdownViewer,
		form: LazyFormMarkdownEditor,
		preview: LazyDetailMarkdownViewer
	}
};

export function getFieldComponent(fieldType: string, context: FieldContext) {
	const byType = fieldComponentMap[fieldType] ?? fieldComponentMap.text;
	return byType[context];
}
