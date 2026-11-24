import type { MutationCtx, QueryCtx } from '../../convex/_generated/server';
import { authComponent } from '../authServer';
import { isAnonymousUser } from '../utils/anonymousUser';

type SupportAccessCtx = QueryCtx | MutationCtx;

export type SupportOwnerIdentity = {
	ownerId: string;
	anonymousUserId?: string;
	isAnonymous: boolean;
};

export async function getSupportOwnerIdentity(
	ctx: SupportAccessCtx,
	anonymousUserId?: string
): Promise<SupportOwnerIdentity | null> {
	const authUser = await authComponent.safeGetAuthUser(ctx);
	if (authUser) {
		return {
			ownerId: authUser._id,
			isAnonymous: false
		};
	}

	if (anonymousUserId && isAnonymousUser(anonymousUserId)) {
		return {
			ownerId: anonymousUserId,
			anonymousUserId,
			isAnonymous: true
		};
	}

	return null;
}
