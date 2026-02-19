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
	namespace: (doc) => (doc.deletedAt === undefined ? 'projectLive:live' : 'projectLive:trashed')
});

const projectStatusCountAggregate = new TableAggregate<ProjectAggregateShape>(
	components.aggregate,
	{
		sortKey: (doc) => doc.createdAt,
		namespace: (doc) =>
			doc.deletedAt === undefined ? `projectStatus:live:${doc.status}` : 'projectStatus:trashed'
	}
);

const projectFeaturedCountAggregate = new TableAggregate<ProjectAggregateShape>(
	components.aggregate,
	{
		sortKey: (doc) => doc.createdAt,
		namespace: (doc) =>
			doc.deletedAt === undefined && doc.isFeatured
				? 'projectFeatured:live:featured'
				: 'projectFeatured:other'
	}
);

const projectBudgetSumAggregate = new TableAggregate<ProjectAggregateShape>(components.aggregate, {
	sortKey: (doc) => doc.createdAt,
	sumValue: (doc) => doc.budget,
	namespace: (doc) =>
		doc.deletedAt === undefined && doc.status === 'active'
			? 'projectBudget:live:active'
			: 'projectBudget:other'
});

const taskLiveCountAggregate = new TableAggregate<TaskAggregateShape>(components.aggregate, {
	sortKey: (doc) => doc.createdAt,
	namespace: (doc) => (doc.deletedAt === undefined ? 'taskLive:live' : 'taskLive:trashed')
});

const taskStatusCountAggregate = new TableAggregate<TaskAggregateShape>(components.aggregate, {
	sortKey: (doc) => doc.createdAt,
	namespace: (doc) =>
		doc.deletedAt === undefined ? `taskStatus:live:${doc.status}` : 'taskStatus:trashed'
});

const taskPriorityCountAggregate = new TableAggregate<TaskAggregateShape>(components.aggregate, {
	sortKey: (doc) => doc.createdAt,
	namespace: (doc) =>
		doc.deletedAt === undefined ? `taskPriority:live:${doc.priority}` : 'taskPriority:trashed'
});

const taskEstimateTotalAggregate = new TableAggregate<TaskAggregateShape>(components.aggregate, {
	sortKey: (doc) => doc.createdAt,
	sumValue: (doc) => doc.estimateHours,
	namespace: (doc) =>
		doc.deletedAt === undefined ? 'taskEstimateTotal:live' : 'taskEstimateTotal:trashed'
});

const taskEstimateByStatusAggregate = new TableAggregate<TaskAggregateShape>(components.aggregate, {
	sortKey: (doc) => doc.createdAt,
	sumValue: (doc) => doc.estimateHours,
	namespace: (doc) =>
		doc.deletedAt === undefined
			? `taskEstimateByStatus:live:${doc.status}`
			: 'taskEstimateByStatus:trashed'
});

const commentLiveCountAggregate = new TableAggregate<CommentAggregateShape>(components.aggregate, {
	sortKey: (doc) => doc.createdAt,
	namespace: (doc) => (doc.deletedAt === undefined ? 'commentLive:live' : 'commentLive:trashed')
});

const commentTargetCountAggregate = new TableAggregate<CommentAggregateShape>(
	components.aggregate,
	{
		sortKey: (doc) => doc.createdAt,
		namespace: (doc) =>
			doc.deletedAt === undefined
				? `commentTarget:live:${doc.target.kind}`
				: 'commentTarget:trashed'
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
	return projectStatusCountAggregate.count(ctx, { namespace: `projectStatus:live:${status}` });
}

export async function aggregateCountFeaturedProjects(ctx: QueryCtx) {
	return projectFeaturedCountAggregate.count(ctx, { namespace: 'projectFeatured:live:featured' });
}

export async function aggregateSumActiveProjectBudget(ctx: QueryCtx) {
	return projectBudgetSumAggregate.sum(ctx, { namespace: 'projectBudget:live:active' });
}

export async function aggregateCountLiveTasks(ctx: QueryCtx) {
	return taskLiveCountAggregate.count(ctx, { namespace: 'taskLive:live' });
}

export async function aggregateCountTasksByStatus(
	ctx: QueryCtx,
	status: Doc<'adminDemoTasks'>['status']
) {
	return taskStatusCountAggregate.count(ctx, { namespace: `taskStatus:live:${status}` });
}

export async function aggregateCountTasksByPriority(
	ctx: QueryCtx,
	priority: Doc<'adminDemoTasks'>['priority']
) {
	return taskPriorityCountAggregate.count(ctx, { namespace: `taskPriority:live:${priority}` });
}

export async function aggregateSumTaskEstimate(ctx: QueryCtx) {
	return taskEstimateTotalAggregate.sum(ctx, { namespace: 'taskEstimateTotal:live' });
}

export async function aggregateSumTaskEstimateByStatus(
	ctx: QueryCtx,
	status: Doc<'adminDemoTasks'>['status']
) {
	return taskEstimateByStatusAggregate.sum(ctx, {
		namespace: `taskEstimateByStatus:live:${status}`
	});
}

export async function aggregateCountLiveComments(ctx: QueryCtx) {
	return commentLiveCountAggregate.count(ctx, { namespace: 'commentLive:live' });
}

export async function aggregateCountCommentsByTarget(
	ctx: QueryCtx,
	kind: Doc<'adminDemoComments'>['target']['kind']
) {
	return commentTargetCountAggregate.count(ctx, { namespace: `commentTarget:live:${kind}` });
}
