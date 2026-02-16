export type FieldPolicy<TItem extends Record<string, unknown>> = {
	attribute: string;
	canSee?: (user: { role?: string | null } | null | undefined, item: TItem) => boolean;
};

const DEFAULT_KEEP_KEYS = ['_id', '_creationTime', 'deletedAt'] as const;

function evaluatePolicy<TItem extends Record<string, unknown>>(
	policy: FieldPolicy<TItem>,
	user: { role?: string | null } | null | undefined,
	item: TItem
) {
	if (!policy.canSee) return true;
	return Boolean(user && user.role === 'admin' && policy.canSee(user, item));
}

export function applyFieldVisibility<TItem extends Record<string, unknown>>(args: {
	item: TItem;
	user: { role?: string | null } | null | undefined;
	policies: FieldPolicy<TItem>[];
	keepKeys?: string[];
}) {
	const keepKeys = args.keepKeys ?? [...DEFAULT_KEEP_KEYS];
	const visibleFields = args.policies
		.filter((policy) => evaluatePolicy(policy, args.user, args.item))
		.map((policy) => policy.attribute);

	const next: Record<string, unknown> = {};
	for (const key of keepKeys) {
		if (key in args.item) {
			next[key] = args.item[key];
		}
	}
	for (const field of visibleFields) {
		if (field in args.item) {
			next[field] = args.item[field];
		}
	}

	return {
		...next,
		_visibleFields: visibleFields
	} as TItem & { _visibleFields: string[] };
}

export function applyFieldVisibilityList<TItem extends Record<string, unknown>>(args: {
	items: TItem[];
	user: { role?: string | null } | null | undefined;
	policies: FieldPolicy<TItem>[];
	keepKeys?: string[];
}) {
	return args.items.map((item) =>
		applyFieldVisibility({
			item,
			user: args.user,
			policies: args.policies,
			keepKeys: args.keepKeys
		})
	);
}
