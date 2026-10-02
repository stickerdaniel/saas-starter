/**
 * Who the current events belong to, derived from the Better Auth session atom.
 *
 * Anything uncertain is `pending`, which keeps analytics closed: the first load, a
 * refetch (a sign-out, account switch or impersonation start can be in flight), and a
 * failed refetch that kept the previous data. A 401 clears the data and is a
 * confirmed signed-out visitor.
 */

export type AuthState =
	| { kind: 'pending' }
	| { kind: 'anonymous' }
	| { kind: 'user'; userId: string }
	| { kind: 'impersonating' };

export interface SessionSnapshot {
	data: {
		user?: { id?: string | null } | null;
		session?: { impersonatedBy?: string | null } | null;
	} | null;
	isPending: boolean;
	isRefetching?: boolean;
	error: { status?: number } | null;
}

export function classifySession(snapshot: SessionSnapshot): AuthState {
	if (snapshot.isPending || snapshot.isRefetching) return { kind: 'pending' };
	if (snapshot.error) {
		return snapshot.error.status === 401 && !snapshot.data
			? { kind: 'anonymous' }
			: { kind: 'pending' };
	}
	const userId = snapshot.data?.user?.id;
	if (!userId) return { kind: 'anonymous' };
	if (snapshot.data?.session?.impersonatedBy) return { kind: 'impersonating' };
	return { kind: 'user', userId };
}

export interface SdkIdentity {
	identified: boolean;
	distinctId: string;
}

export type IdentityPlan =
	{ ready: false } | { ready: true; resetFirst: boolean; identify: string | undefined };

/**
 * What to do before ordinary events may flow. `identify` runs after admission opens,
 * so the anonymous-to-user merge event is sent rather than filtered out.
 */
export function planIdentity(auth: AuthState, sdk: SdkIdentity): IdentityPlan {
	switch (auth.kind) {
		case 'pending':
		case 'impersonating':
			return { ready: false };
		case 'anonymous':
			return { ready: true, resetFirst: sdk.identified, identify: undefined };
		case 'user': {
			if (sdk.identified && sdk.distinctId === auth.userId) {
				return { ready: true, resetFirst: false, identify: undefined };
			}
			return { ready: true, resetFirst: sdk.identified, identify: auth.userId };
		}
	}
}
