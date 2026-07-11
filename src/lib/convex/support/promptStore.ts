import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';

/**
 * Runtime override store for the support agent's system prompt.
 *
 * Lets you hot-swap Kai's system prompt straight from the database, with no
 * deploy: support/messages.ts reads the active row before every streamed reply
 * and passes it as the per-turn system override. When no row is active the agent
 * falls back to the seed prompt in code (SUPPORT_AGENT_INSTRUCTIONS in agent.ts),
 * so the source stays the safety net. A prompt-optimization pipeline can write
 * its winning prompt here via savePrompt to ship it without editing source.
 *
 * At most one row is active per locale. getActive prefers an exact-locale row
 * over a locale-less one, so a global default and a locale-specific override can
 * coexist.
 */

/**
 * Resolve the active support system prompt for a request. Returns the active
 * prompt's systemPrompt, or null when none is active (the caller then falls back
 * to SUPPORT_AGENT_INSTRUCTIONS). Read on the hot path by support/messages.ts
 * before every streamed reply.
 */
export const getActive = internalQuery({
	args: { locale: v.optional(v.string()) },
	returns: v.union(v.string(), v.null()),
	handler: async (ctx, { locale }) => {
		// Bounded: at most one active row per locale. The by_active index keeps
		// this off a full-table scan.
		const active = await ctx.db
			.query('supportAgentPrompts')
			.withIndex('by_active', (q) => q.eq('active', true))
			.collect();
		if (active.length === 0) return null;
		// Prefer a prompt scoped to the request's locale; otherwise serve the
		// locale-less default (a global override), then any active row as a last
		// resort.
		const exact = locale ? active.find((row) => row.locale === locale) : undefined;
		const fallback = active.find((row) => row.locale === undefined);
		const chosen = exact ?? fallback ?? active[0];
		return chosen?.systemPrompt ?? null;
	}
});

/**
 * Persist a new support prompt and make it the one served for its locale.
 * Deactivates the locale's currently-active row first, so getActive only ever
 * resolves one prompt per locale. Returns the new row's id.
 */
export const savePrompt = internalMutation({
	args: {
		systemPrompt: v.string(),
		locale: v.optional(v.string()),
		note: v.optional(v.string())
	},
	returns: v.id('supportAgentPrompts'),
	handler: async (ctx, { systemPrompt, locale, note }) => {
		// Bounded: at most one active row per locale; the by_active index keeps
		// this off a full scan.
		const active = await ctx.db
			.query('supportAgentPrompts')
			.withIndex('by_active', (q) => q.eq('active', true))
			.collect();
		for (const row of active) {
			// Sequential patches over a tiny active set (one row per locale).
			if (row.locale === locale) {
				await ctx.db.patch(row._id, { active: false });
			}
		}
		return await ctx.db.insert('supportAgentPrompts', {
			systemPrompt,
			...(locale !== undefined ? { locale } : {}),
			...(note !== undefined ? { note } : {}),
			active: true,
			createdAt: Date.now()
		});
	}
});

/**
 * Operator lever: flip a stored prompt's active flag. Activating a row
 * deactivates the other active rows of its locale first, so getActive still
 * resolves a single prompt per locale. Deactivating the live row rolls the
 * support agent back to the SUPPORT_AGENT_INSTRUCTIONS fallback without a new
 * savePrompt.
 */
export const setActive = internalMutation({
	args: { id: v.id('supportAgentPrompts'), active: v.boolean() },
	returns: v.null(),
	handler: async (ctx, { id, active }) => {
		if (active) {
			const target = await ctx.db.get(id);
			if (target === null) return null;
			const siblings = await ctx.db
				.query('supportAgentPrompts')
				.withIndex('by_active', (q) => q.eq('active', true))
				.collect();
			for (const row of siblings) {
				if (row._id !== id && row.locale === target.locale) {
					await ctx.db.patch(row._id, { active: false });
				}
			}
		}
		await ctx.db.patch(id, { active });
		return null;
	}
});
