import { v } from 'convex/values';
import { permissionMutation, permissionQuery, assertPermission } from '../access';
import {
	countArgsValidator,
	listArgsValidator,
	resolveLastPage,
	resolveLastPageArgsValidator,
	runResourceListQuery
} from '../utils/resource_query';
import { notFoundError } from '../utils/errors';

export const listTags = permissionQuery({
	args: listArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const tags = await ctx.db.query('adminDemoTags').collect();
		const result = runResourceListQuery({
			items: tags,
			cursor: args.cursor,
			numItems: args.numItems,
			search: args.search,
			sortBy: args.sortBy,
			sortMap: {
				name: (item) => item.name,
				createdAt: (item) => item.createdAt
			},
			searchableValues: (item) => [item.name]
		});
		return {
			items: result.items,
			continueCursor: result.continueCursor,
			isDone: result.isDone
		};
	}
});

export const countTags = permissionQuery({
	args: countArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const tags = await ctx.db.query('adminDemoTags').collect();
		return runResourceListQuery({
			items: tags,
			numItems: tags.length || 1,
			search: args.search,
			searchableValues: (item) => [item.name]
		}).totalCount;
	}
});

export const resolveTagsLastPage = permissionQuery({
	args: resolveLastPageArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const tags = await ctx.db.query('adminDemoTags').collect();
		const totalCount = runResourceListQuery({
			items: tags,
			numItems: tags.length || 1,
			search: args.search,
			searchableValues: (item) => [item.name]
		}).totalCount;
		return resolveLastPage({ totalCount, numItems: args.numItems });
	}
});

export const getTagById = permissionQuery({
	args: { id: v.id('adminDemoTags') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const tag = await ctx.db.get(args.id);
		if (!tag) notFoundError('Tag');
		return tag;
	}
});

const tagValuesValidator = v.object({
	name: v.string(),
	color: v.string()
});

export const createTag = permissionMutation({
	args: tagValuesValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['create'] });
		const now = Date.now();
		const id = await ctx.db.insert('adminDemoTags', {
			name: args.name,
			color: args.color,
			createdAt: now,
			updatedAt: now
		});
		return { id };
	}
});

export const updateTag = permissionMutation({
	args: { id: v.id('adminDemoTags'), values: tagValuesValidator },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['update'] });
		const tag = await ctx.db.get(args.id);
		if (!tag) notFoundError('Tag');
		await ctx.db.patch(args.id, {
			name: args.values.name,
			color: args.values.color,
			updatedAt: Date.now()
		});
		return { id: args.id };
	}
});

export const deleteTag = permissionMutation({
	args: { id: v.id('adminDemoTags') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['delete'] });
		const tag = await ctx.db.get(args.id);
		if (!tag) notFoundError('Tag');

		const pivots = await ctx.db
			.query('adminDemoProjectTags')
			.withIndex('by_tag', (q) => q.eq('tagId', args.id))
			.collect();
		for (const pivot of pivots) {
			await ctx.db.delete(pivot._id);
		}
		await ctx.db.delete(args.id);
		return { id: args.id };
	}
});

export const restoreTag = permissionMutation({
	args: { id: v.id('adminDemoTags') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['update'] });
		return { id: args.id };
	}
});

export const forceDeleteTag = permissionMutation({
	args: { id: v.id('adminDemoTags') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['delete'] });
		const tag = await ctx.db.get(args.id);
		if (!tag) notFoundError('Tag');

		const pivots = await ctx.db
			.query('adminDemoProjectTags')
			.withIndex('by_tag', (q) => q.eq('tagId', args.id))
			.collect();
		for (const pivot of pivots) {
			await ctx.db.delete(pivot._id);
		}
		await ctx.db.delete(args.id);
		return { id: args.id };
	}
});

export const replicateTag = permissionMutation({
	args: { id: v.id('adminDemoTags') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['replicate'] });
		const tag = await ctx.db.get(args.id);
		if (!tag) notFoundError('Tag');
		const id = await ctx.db.insert('adminDemoTags', {
			name: `${tag.name} Copy`,
			color: tag.color,
			createdAt: Date.now(),
			updatedAt: Date.now()
		});
		return { id };
	}
});

export const runTagAction = permissionMutation({
	args: {
		action: v.union(v.literal('noop')),
		ids: v.array(v.id('adminDemoTags'))
	},
	handler: async (_ctx) => {
		return { type: 'message', text: 'No-op.' };
	}
});

export const getTagMetrics = permissionQuery({
	args: {},
	handler: async (ctx) => {
		assertPermission(ctx.user, { metric: ['read'] });
		const tags = await ctx.db.query('adminDemoTags').collect();
		return {
			cards: [{ key: 'total', type: 'value', value: tags.length }]
		};
	}
});
