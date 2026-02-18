import type { Component } from 'svelte';
import type { IconProps } from '@lucide/svelte';
import type { GenericSchema } from 'valibot';
import type { FunctionReference } from 'convex/server';
import type { BetterAuthUser } from '$lib/convex/admin/types';

type QueryRef = FunctionReference<'query'>;
type MutationRef = FunctionReference<'mutation'>;

export type ResourceRuntime = {
	list: QueryRef;
	count: QueryRef;
	resolveLastPage: QueryRef;
	getById: QueryRef;
	create: MutationRef;
	update: MutationRef;
	delete: MutationRef;
	restore: MutationRef;
	forceDelete: MutationRef;
	replicate: MutationRef;
	runAction: MutationRef;
	getMetrics: QueryRef;
	listRelationOptions?: Record<string, QueryRef>;
};

export type ResourceModule = {
	resource: ResourceDefinition<any>;
	runtime: ResourceRuntime;
};

export type LucideIcon = Component<IconProps, object, ''>;

export type FieldType =
	| 'text'
	| 'textarea'
	| 'number'
	| 'boolean'
	| 'select'
	| 'date'
	| 'datetime'
	| 'image'
	| 'file'
	| 'email'
	| 'url'
	| 'json'
	| 'code'
	| 'markdown'
	| 'badge'
	| 'belongsTo'
	| 'hasMany'
	| 'manyToMany'
	| 'morphTo';

export type FieldContext = 'index' | 'detail' | 'form' | 'preview';

export type FieldDependency = {
	field: string;
	value?: unknown;
	predicate?: (value: unknown) => boolean;
};

export type FieldOption = {
	value: string;
	labelKey: string;
};

export type MorphToTarget = {
	kind: string;
	resourceName: string;
	labelKey: string;
};

export type MorphToConfig = {
	targets: MorphToTarget[];
};

export type FieldDefinition<_TTable extends string = string> = {
	type: FieldType;
	attribute: string;
	labelKey: string;
	helpTextKey?: string;
	placeholderKey?: string;
	ariaLabelKey?: string;
	sortable?: boolean;
	searchable?: boolean;
	filterable?: boolean;
	showOnIndex?: boolean;
	showOnDetail?: boolean;
	showOnForm?: boolean;
	required?: boolean;
	rules?: GenericSchema;
	readonly?: boolean | ((ctx: { user: BetterAuthUser; record?: unknown }) => boolean);
	immutable?: boolean | ((ctx: { user: BetterAuthUser; record?: unknown }) => boolean);
	inlineEditable?: boolean;
	inlineConfirmation?: boolean;
	dependsOn?: FieldDependency;
	resolveUsing?: (record: unknown) => unknown;
	displayUsing?: (value: unknown, record: unknown) => string;
	fillUsing?: (value: unknown) => unknown;
	renderOverride?: Partial<Record<FieldContext, Component<any>>>;
	canSee?: (user: BetterAuthUser, record?: unknown) => boolean;
	securityLevel?: 'server' | 'client';
	options?: FieldOption[];
	defaultValue?: unknown;
	morphTo?: MorphToConfig;
	relation?: {
		resourceName: string;
		valueField: string;
		labelField: string;
		foreignKey?: string;
	};
};

export type ActionDefinition = {
	key: string;
	nameKey: string;
	icon?: LucideIcon;
	confirmTextKey?: string;
	confirmButtonTextKey?: string;
	cancelButtonTextKey?: string;
	destructive?: boolean;
	showOnIndex?: boolean;
	showOnDetail?: boolean;
	showInline?: boolean;
	standalone?: boolean;
	sole?: boolean;
	withoutConfirmation?: boolean;
	fields?: Array<FieldDefinition<any>>;
	canRun?: (user: BetterAuthUser, record?: unknown) => boolean;
};

export type FilterOption = {
	value: string;
	labelKey: string;
};

export type FilterDefinition =
	| {
			key: string;
			labelKey: string;
			type: 'select' | 'boolean';
			urlKey: string;
			defaultValue: string;
			options: FilterOption[];
	  }
	| {
			key: string;
			labelKey: string;
			type: 'date-range';
			urlKey: string;
			defaultValue: string;
			options?: FilterOption[];
	  };

export type LensDefinition<TTable extends string = string> = {
	key: string;
	nameKey: string;
	fields?: Array<FieldDefinition<TTable>>;
	filters?: FilterDefinition[];
	actions?: ActionDefinition[];
};

export type MetricDefinition = {
	key: string;
	type: 'value' | 'trend' | 'partition' | 'progress' | 'table';
	labelKey: string;
	rangeOptions?: Array<{ value: string; labelKey: string }>;
	format?: 'number' | 'currency' | 'percent';
};

export type FieldGroupDefinition = {
	key: string;
	labelKey: string;
	fields: string[];
	contexts?: FieldContext[];
};

export type ResourceDefinition<TTable extends string = string> = {
	name: string;
	table: TTable;
	tenantScoped?: boolean;
	groupKey: string;
	navTitleKey: string;
	icon: LucideIcon;
	title: (record: Record<string, unknown>) => string;
	subtitle?: (record: Record<string, unknown>) => string;
	search?: string[];
	sortFields?: string[];
	perPageOptions?: number[];
	softDeletes?: boolean;
	clickAction?: 'detail' | 'edit' | 'select' | 'preview' | 'ignore';
	fields: Array<FieldDefinition<TTable>>;
	filters?: FilterDefinition[];
	actions?: ActionDefinition[];
	lenses?: Array<LensDefinition<TTable>>;
	metrics?: MetricDefinition[];
	fieldGroups?: FieldGroupDefinition[];
	badgeQuery?: {
		trashed?: 'without' | 'with' | 'only';
		filters?: Record<string, string>;
		lens?: string;
	};
	canSee?: (user: BetterAuthUser) => boolean;
	canCreate?: (user: BetterAuthUser) => boolean;
	canUpdate?: (user: BetterAuthUser, record: Record<string, unknown>) => boolean;
	canDelete?: (user: BetterAuthUser, record: Record<string, unknown>) => boolean;
};

export type ResourceName = string;

export type ResourceGroup = {
	groupKey: string;
	resources: ResourceDefinition<any>[];
};
