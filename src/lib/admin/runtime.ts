import { api } from '$lib/convex/_generated/api';
import type { FunctionReference } from 'convex/server';

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

export const adminResourceRuntimeMap: Record<string, ResourceRuntime> = {
	'demo-projects': {
		list: api.adminFramework.resources.projects.listProjects,
		count: api.adminFramework.resources.projects.countProjects,
		resolveLastPage: api.adminFramework.resources.projects.resolveProjectsLastPage,
		getById: api.adminFramework.resources.projects.getProjectById,
		create: api.adminFramework.resources.projects.createProject,
		update: api.adminFramework.resources.projects.updateProject,
		delete: api.adminFramework.resources.projects.deleteProject,
		restore: api.adminFramework.resources.projects.restoreProject,
		forceDelete: api.adminFramework.resources.projects.forceDeleteProject,
		replicate: api.adminFramework.resources.projects.replicateProject,
		runAction: api.adminFramework.resources.projects.runProjectAction,
		getMetrics: api.adminFramework.resources.projects.getProjectMetrics,
		listRelationOptions: {
			tagId: api.adminFramework.resources.projects.listProjectTagOptions,
			tagIds: api.adminFramework.resources.projects.listProjectTagOptions
		}
	},
	'demo-tasks': {
		list: api.adminFramework.resources.tasks.listTasks,
		count: api.adminFramework.resources.tasks.countTasks,
		resolveLastPage: api.adminFramework.resources.tasks.resolveTasksLastPage,
		getById: api.adminFramework.resources.tasks.getTaskById,
		create: api.adminFramework.resources.tasks.createTask,
		update: api.adminFramework.resources.tasks.updateTask,
		delete: api.adminFramework.resources.tasks.deleteTask,
		restore: api.adminFramework.resources.tasks.restoreTask,
		forceDelete: api.adminFramework.resources.tasks.forceDeleteTask,
		replicate: api.adminFramework.resources.tasks.replicateTask,
		runAction: api.adminFramework.resources.tasks.runTaskAction,
		getMetrics: api.adminFramework.resources.tasks.getTaskMetrics,
		listRelationOptions: {
			projectId: api.adminFramework.resources.projects.listProjectOptions
		}
	},
	'demo-comments': {
		list: api.adminFramework.resources.comments.listComments,
		count: api.adminFramework.resources.comments.countComments,
		resolveLastPage: api.adminFramework.resources.comments.resolveCommentsLastPage,
		getById: api.adminFramework.resources.comments.getCommentById,
		create: api.adminFramework.resources.comments.createComment,
		update: api.adminFramework.resources.comments.updateComment,
		delete: api.adminFramework.resources.comments.deleteComment,
		restore: api.adminFramework.resources.comments.restoreComment,
		forceDelete: api.adminFramework.resources.comments.forceDeleteComment,
		replicate: api.adminFramework.resources.comments.replicateComment,
		runAction: api.adminFramework.resources.comments.runCommentAction,
		getMetrics: api.adminFramework.resources.comments.getCommentMetrics,
		listRelationOptions: {
			'demo-projects': api.adminFramework.resources.projects.listProjectOptions,
			'demo-tasks': api.adminFramework.resources.tasks.listTaskOptions
		}
	},
	'demo-tags': {
		list: api.adminFramework.resources.tags.listTags,
		count: api.adminFramework.resources.tags.countTags,
		resolveLastPage: api.adminFramework.resources.tags.resolveTagsLastPage,
		getById: api.adminFramework.resources.tags.getTagById,
		create: api.adminFramework.resources.tags.createTag,
		update: api.adminFramework.resources.tags.updateTag,
		delete: api.adminFramework.resources.tags.deleteTag,
		restore: api.adminFramework.resources.tags.restoreTag,
		forceDelete: api.adminFramework.resources.tags.forceDeleteTag,
		replicate: api.adminFramework.resources.tags.replicateTag,
		runAction: api.adminFramework.resources.tags.runTagAction,
		getMetrics: api.adminFramework.resources.tags.getTagMetrics
	}
};
