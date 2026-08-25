import { internal } from '../_generated/api';
import type { MutationCtx } from '../_generated/server';
import type { FounderWelcomeConfig } from '../admin/founderWelcome/queries';
import { createFounderIncidentEmailMutation } from './founderIncidentCore';
import { founderIncidentRegistry } from './founderIncidentRegistry';
import type { FounderIncidentContact } from './founderIncidentTypes';

async function resolveFounderIncidentContact(
	ctx: MutationCtx
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
