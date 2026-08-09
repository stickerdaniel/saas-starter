import type {
	ActionBuilder,
	MutationBuilder,
	QueryBuilder,
	GenericDataModel
} from 'convex/server';

export declare const mutation: MutationBuilder<GenericDataModel, 'public'>;
export declare const query: QueryBuilder<GenericDataModel, 'public'>;
export declare const internalAction: ActionBuilder<GenericDataModel, 'internal'>;
