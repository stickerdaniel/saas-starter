import { TableAggregate } from '@convex-dev/aggregate';
import { Triggers } from 'convex-helpers/server/triggers';
import { components } from '../../_generated/api';
import type { DataModel, Doc } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';

type TagAggregateShape = {
	Key: number;
	DataModel: DataModel;
	TableName: 'adminDemoTags';
};

type ProjectAggregateShape = {
	Key: number;
	DataModel: DataModel;
	TableName: 'adminDemoProjects';
	Namespace: string;
};

type TaskAggregateShape = {
	Key: number;
	DataModel: DataModel;
	TableName: 'adminDemoTasks';
	Namespace: string;
};

type CommentAggregateShape = {
	Key: number;
	DataModel: DataModel;
	TableName: 'adminDemoComments';
	Namespace: string;
};

const tagCountAggregate = new TableAggregate<TagAggregateShape>(components.aggregate, {
	sortKey: (doc) => doc.createdAt
});

const projectLiveCountAggregate = new TableAggregate<ProjectAggregateShape>(components.aggregate, {
	sortKey: (doc) => doc.createdAt,
	namespace: (doc) => (doc.deletedAt === undefined ? 'live' : 'trashed')
});

const projectStatusCountAggregate = new TableAggregate<ProjectAggregateShape>(
	components.aggregate,
	{
		sortKey: (doc) => doc.createdAt,
		namespace: (doc) => (doc.deletedAt === undefined ? `live:${doc.status}` : 'trashed')
	}
);

const projectFeaturedCountAggregate = new TableAggregate<ProjectAggregateShape>(
	components.aggregate,
	{
		sortKey: (doc) => doc.createdAt,
		namespace: (doc) => (doc.deletedAt === undefined && doc.isFeatured ? 'live:featured' : 'other')
	}
);

const projectBudgetSumAggregate = new TableAggregate<ProjectAggregateShape>(components.aggregate, {
	sortKey: (doc) => doc.createdAt,
	sumValue: (doc) => doc.budget,
	namespace: (doc) =>
		doc.deletedAt === undefined && doc.status === 'active' ? 'live:active' : 'other'
});

const taskLiveCountAggregate = new TableAggregate<TaskAggregateShape>(components.aggregate, {
	sortKey: (doc) => doc.createdAt,
	namespace: (doc) => (doc.deletedAt === undefined ? 'live' : 'trashed')
});

const taskStatusCountAggregate = new TableAggregate<TaskAggregateShape>(components.aggregate, {
	sortKey: (doc) => doc.createdAt,
	namespace: (doc) => (doc.deletedAt === undefined ? `live:${doc.status}` : 'trashed')
});

const taskPriorityCountAggregate = new TableAggregate<TaskAggregateShape>(components.aggregate, {
	sortKey: (doc) => doc.createdAt,
	namespace: (doc) => (doc.deletedAt === undefined ? `live:${doc.priority}` : 'trashed')
});

const taskEstimateTotalAggregate = new TableAggregate<TaskAggregateShape>(components.aggregate, {
	sortKey: (doc) => doc.createdAt,
	sumValue: (doc) => doc.estimateHours,
	namespace: (doc) => (doc.deletedAt === undefined ? 'live' : 'trashed')
});

const taskEstimateByStatusAggregate = new TableAggregate<TaskAggregateShape>(components.aggregate, {
	sortKey: (doc) => doc.createdAt,
	sumValue: (doc) => doc.estimateHours,
	namespace: (doc) => (doc.deletedAt === undefined ? `live:${doc.status}` : 'trashed')
});

const commentLiveCountAggregate = new TableAggregate<CommentAggregateShape>(components.aggregate, {
	sortKey: (doc) => doc.createdAt,
	namespace: (doc) => (doc.deletedAt === undefined ? 'live' : 'trashed')
});

const commentTargetCountAggregate = new TableAggregate<CommentAggregateShape>(
	components.aggregate,
	{
		sortKey: (doc) => doc.createdAt,
		namespace: (doc) => (doc.deletedAt === undefined ? `live:${doc.target.kind}` : 'trashed')
	}
);

export const adminFrameworkAggregateTriggers = new Triggers<DataModel>();
adminFrameworkAggregateTriggers.register('adminDemoTags', tagCountAggregate.idempotentTrigger());
adminFrameworkAggregateTriggers.register(
	'adminDemoProjects',
	projectLiveCountAggregate.idempotentTrigger()
);
adminFrameworkAggregateTriggers.register(
	'adminDemoProjects',
	projectStatusCountAggregate.idempotentTrigger()
);
adminFrameworkAggregateTriggers.register(
	'adminDemoProjects',
	projectFeaturedCountAggregate.idempotentTrigger()
);
adminFrameworkAggregateTriggers.register(
	'adminDemoProjects',
	projectBudgetSumAggregate.idempotentTrigger()
);
adminFrameworkAggregateTriggers.register(
	'adminDemoTasks',
	taskLiveCountAggregate.idempotentTrigger()
);
adminFrameworkAggregateTriggers.register(
	'adminDemoTasks',
	taskStatusCountAggregate.idempotentTrigger()
);
adminFrameworkAggregateTriggers.register(
	'adminDemoTasks',
	taskPriorityCountAggregate.idempotentTrigger()
);
adminFrameworkAggregateTriggers.register(
	'adminDemoTasks',
	taskEstimateTotalAggregate.idempotentTrigger()
);
adminFrameworkAggregateTriggers.register(
	'adminDemoTasks',
	taskEstimateByStatusAggregate.idempotentTrigger()
);
adminFrameworkAggregateTriggers.register(
	'adminDemoComments',
	commentLiveCountAggregate.idempotentTrigger()
);
adminFrameworkAggregateTriggers.register(
	'adminDemoComments',
	commentTargetCountAggregate.idempotentTrigger()
);

export async function aggregateCountTags(ctx: QueryCtx) {
	return tagCountAggregate.count(ctx);
}

export async function aggregateCountProjectsByStatus(
	ctx: QueryCtx,
	status: Doc<'adminDemoProjects'>['status']
) {
	return projectStatusCountAggregate.count(ctx, { namespace: `live:${status}` });
}

export async function aggregateCountFeaturedProjects(ctx: QueryCtx) {
	return projectFeaturedCountAggregate.count(ctx, { namespace: 'live:featured' });
}

export async function aggregateSumActiveProjectBudget(ctx: QueryCtx) {
	return projectBudgetSumAggregate.sum(ctx, { namespace: 'live:active' });
}

export async function aggregateCountLiveTasks(ctx: QueryCtx) {
	return taskLiveCountAggregate.count(ctx, { namespace: 'live' });
}

export async function aggregateCountTasksByStatus(
	ctx: QueryCtx,
	status: Doc<'adminDemoTasks'>['status']
) {
	return taskStatusCountAggregate.count(ctx, { namespace: `live:${status}` });
}

export async function aggregateCountTasksByPriority(
	ctx: QueryCtx,
	priority: Doc<'adminDemoTasks'>['priority']
) {
	return taskPriorityCountAggregate.count(ctx, { namespace: `live:${priority}` });
}

export async function aggregateSumTaskEstimate(ctx: QueryCtx) {
	return taskEstimateTotalAggregate.sum(ctx, { namespace: 'live' });
}

export async function aggregateSumTaskEstimateByStatus(
	ctx: QueryCtx,
	status: Doc<'adminDemoTasks'>['status']
) {
	return taskEstimateByStatusAggregate.sum(ctx, { namespace: `live:${status}` });
}

export async function aggregateCountLiveComments(ctx: QueryCtx) {
	return commentLiveCountAggregate.count(ctx, { namespace: 'live' });
}

export async function aggregateCountCommentsByTarget(
	ctx: QueryCtx,
	kind: Doc<'adminDemoComments'>['target']['kind']
) {
	return commentTargetCountAggregate.count(ctx, { namespace: `live:${kind}` });
}
