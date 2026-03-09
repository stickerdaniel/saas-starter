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
	upsertRelation?: Record<string, MutationRef>;
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
	| 'morphTo'
	| 'password'
	| 'color'
	| 'slug'
	| 'currency'
	| 'hidden'
	| 'keyValue'
	| 'booleanGroup'
	| 'multiselect'
	| 'heading'
	| 'line'
	| 'status'
	| 'avatar'
	| 'tag';

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

export type FieldIndexColumnPreset =
	| 'textSm'
	| 'textMd'
	| 'textLg'
	| 'avatarText'
	| 'email'
	| 'badgeSm'
	| 'badgeMd'
	| 'date'
	| 'number'
	| 'inlineSelect'
	| 'inlineCheckbox'
	| 'relationTitle'
	| 'colorSwatch'
	| 'avatar'
	| 'currency';

export type StatusMappingEntry = {
	labelKey: string;
	variant: 'default' | 'secondary' | 'destructive' | 'outline';
};

export type FieldIndexColumnConfig = {
	preset?: FieldIndexColumnPreset;
	size?: number;
	minSize?: number;
	maxSize?: number;
	fixed?: boolean;
};

export type MorphToTarget = {
	kind: string;
	resourceName: string;
	labelKey: string;
};

export type MorphToConfig = {
	targets: MorphToTarget[];
};

export type FilterableConfig = {
	key?: string;
	labelKey?: string;
	urlKey?: string;
	defaultValue?: string;
	options?: FilterOption[];
	type?: 'select' | 'boolean' | 'date-range' | 'number-range';
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
	filterable?: boolean | FilterableConfig;
	showOnIndex?: boolean;
	showOnDetail?: boolean;
	showOnForm?: boolean;
	/** Show this field in peek popovers (hover on relation links). */
	showWhenPeeking?: boolean;
	/** Show this field in preview modals. */
	showOnPreview?: boolean;
	required?: boolean;
	rules?: GenericSchema;
	readonly?: boolean | ((ctx: { user: BetterAuthUser; record?: unknown }) => boolean);
	immutable?: boolean | ((ctx: { user: BetterAuthUser; record?: unknown }) => boolean);
	inlineEditable?: boolean;
	inlineConfirmation?: boolean;
	dependsOn?: FieldDependency;
	resolveUsing?: (value: unknown, record: unknown, attribute: string) => unknown;
	displayUsing?: (value: unknown, record: unknown, attribute: string) => string;
	fillUsing?: (value: unknown, values: Record<string, unknown>, attribute: string) => unknown;
	renderOverride?: Partial<Record<FieldContext, Component<any>>>;
	indexColumn?: FieldIndexColumnConfig;
	canSee?: (user: BetterAuthUser, record?: unknown) => boolean;
	securityLevel?: 'server' | 'client';
	options?: FieldOption[];
	defaultValue?: unknown;
	slugFrom?: string;
	currencyCode?: string;
	currencyLocale?: string;
	statusMapping?: Record<string, StatusMappingEntry>;
	avatarFallback?: 'initials' | 'gravatar';
	avatarNameField?: string;
	morphTo?: MorphToConfig;
	tagConfig?: {
		/** Allow creating new tags inline from the chips input. Requires an upsert mutation. */
		allowCreate?: boolean;
	};
		relation?: {
			resourceName: string;
			valueField: string;
		labelField: string;
		foreignKey?: string;
		/** Guard: can the user add (create) a new related record? Defaults to true. */
		canAdd?: (user: BetterAuthUser, parentRecord: Record<string, unknown>) => boolean;
		/** Guard: can the user attach an existing record? Defaults to true. */
		canAttach?: (user: BetterAuthUser, parentRecord: Record<string, unknown>) => boolean;
		/** Guard: can the user detach a related record? Defaults to true. */
		canDetach?: (user: BetterAuthUser, parentRecord: Record<string, unknown>) => boolean;
			perPageOptions?: number[];
			/** Show a peek popover when hovering relation links. */
			peekable?: boolean;
		};
	/** Allow creating a related resource inline from a BelongsTo/MorphTo dropdown. */
	inlineCreatable?: boolean | { fields?: string[] };
	/** Maximum character length for text/textarea inputs. */
	maxlength?: number;
	/** When true, prevent typing beyond maxlength (default: allow with warning). */
	enforceMaxlength?: boolean;
	/** Autocomplete suggestions for text inputs. */
	suggestions?: string[] | ((query: string) => Promise<string[]>);
	/** Show an expand/collapse toggle for long content on detail views. */
	expandable?: boolean;
	/** Show a copy-to-clipboard button on index/detail views. */
	copyable?: boolean;
};

export type ActionModalStyle = 'window' | 'fullscreen';
export type ActionModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl';

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
	chunkSize?: number;
	canRun?: (user: BetterAuthUser, record?: unknown) => boolean;
	/** Modal display style: 'window' (default centered dialog) or 'fullscreen' (viewport-filling). */
	modalStyle?: ActionModalStyle;
	/** Modal width for window style: 'sm' | 'md' | 'lg' (default) | 'xl' | '2xl'. Ignored in fullscreen mode. */
	modalSize?: ActionModalSize;
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
			/** Show a search box inside the filter dropdown (useful for many options). */
			searchable?: boolean;
	  }
	| {
			key: string;
			labelKey: string;
			type: 'date-range';
			urlKey: string;
			defaultValue: string;
			options?: FilterOption[];
	  }
	| {
			key: string;
			labelKey: string;
			type: 'number-range';
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

export type MetricWidth = 'full' | '1/3' | '1/2' | '1/4' | '2/3' | '3/4';
export type MetricHeight = 'fixed' | 'dynamic';

export type MetricDefinition = {
	key: string;
	type: 'value' | 'trend' | 'partition' | 'progress' | 'table';
	labelKey: string;
	rangeOptions?: Array<{ value: string; labelKey: string }>;
	format?: 'number' | 'currency' | 'percent';
	icon?: LucideIcon;
	descriptionKey?: string;
	subtitleKey?: string;
	/** Invert progress color logic (red = high, green = low). */
	avoid?: boolean;
	/** Progress visualization style (default: 'bar'). */
	display?: 'bar' | 'radial';
	/** Card width in 12-column grid (default: '1/3'). */
	width?: MetricWidth;
	/** Card height behavior: 'fixed' = fixed 200px, 'dynamic' = auto height with 200px min (default: 'fixed'). Full-width cards default to 'dynamic'. */
	height?: MetricHeight;
	/** Show this metric only on the detail page (not on the index list page). */
	onlyOnDetail?: boolean;
};

export type FieldGroupDefinition = {
	key: string;
	labelKey: string;
	fields: string[];
	contexts?: FieldContext[];
	/** Allow collapsing this field group in detail/form views. */
	collapsible?: boolean;
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
	/** i18n key for the create button label (defaults to generic "Create"). */
	createButtonLabelKey?: string;
	/** i18n key for the update/save button label (defaults to generic "Update"). */
	updateButtonLabelKey?: string;
	/** Where to navigate after successful create. */
	redirectAfterCreate?: 'index' | 'detail' | 'edit' | ((id: string) => string);
	/** Where to navigate after successful update. */
	redirectAfterUpdate?: 'index' | 'detail' | ((id: string) => string);
	/** Where to navigate after successful delete. */
	redirectAfterDelete?: 'index' | string;
	/** Table density style for the index page. */
	tableStyle?: 'default' | 'tight';
	/** Show vertical borders between table columns on the index page. */
	showColumnBorders?: boolean;
	/** Include this resource in global admin search (default true if search fields configured). */
	globallySearchable?: boolean;
};

export type ResourceName = string;

export type ResourceGroup = {
	groupKey: string;
	resources: ResourceDefinition<any>[];
};
