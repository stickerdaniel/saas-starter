import { internal } from '../_generated/api';
import type { QueryCtx } from '../_generated/server';
import type { FounderWelcomeConfig } from '../admin/founderWelcome/queries';
import { createFounderIncidentEmailMutation } from '../../confect/emails/founderIncidentCore';
import { founderIncidentRegistry } from '../../confect/emails/founderIncidentRegistry';
import type { FounderIncidentContact } from '../../confect/emails/founderIncidentTypes';

export async function resolveFounderIncidentContact(
	ctx: QueryCtx
): Promise<FounderIncidentContact | null> {
	const config: FounderWelcomeConfig = await ctx.runQuery(
		internal.admin.founderWelcome.queries.getFounderWelcomeConfigInternal,
		{}
	);
	if (!config.enabled) return null;
	return { name: config.name, replyTo: config.replyTo };
}

export const queueFounderIncidentEmail = createFounderIncidentEmailMutation({
	registry: founderIncidentRegistry,
	resolveContact: resolveFounderIncidentContact
});
