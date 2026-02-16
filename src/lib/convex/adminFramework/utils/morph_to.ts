export type MorphTarget = { kind: string; id: string };

export function getMorphTargetIndex(
	kind: string,
	indexByKind: Record<string, string>
): string | undefined {
	return indexByKind[kind];
}

export function parseMorphTarget(value: string, allowedKinds?: string[]): MorphTarget | null {
	const [kind, id] = value.split(':');
	if (!id) return null;
	if (!kind) return null;
	if (Array.isArray(allowedKinds) && !allowedKinds.includes(kind)) return null;
	return { kind, id };
}

export function serializeMorphTarget(target: MorphTarget | null | undefined): string {
	if (!target?.kind || !target.id) return '';
	return `${target.kind}:${target.id}`;
}

export function toMorphIndexFields(
	target: MorphTarget,
	indexFieldByKind: Record<string, string>
): Record<string, string | undefined> {
	const fields = Object.values(indexFieldByKind);
	const output: Record<string, string | undefined> = {};
	for (const field of fields) {
		output[field] = undefined;
	}
	const field = indexFieldByKind[target.kind];
	if (field) {
		output[field] = target.id;
	}
	return output;
}

export function resolveMorphToTarget(ctx: {
	getByKind: Record<string, (id: string) => Promise<{ title: string } | null>>;
	target: MorphTarget;
	fallbackTitleByKind?: Record<string, string>;
}) {
	const resolver = ctx.getByKind[ctx.target.kind];
	if (!resolver) return Promise.resolve({ kind: ctx.target.kind, title: ctx.target.id });

	return resolver(ctx.target.id).then((record) => {
		if (record) {
			return {
				kind: ctx.target.kind,
				title: record.title
			};
		}
		return {
			kind: ctx.target.kind,
			title: ctx.fallbackTitleByKind?.[ctx.target.kind] ?? 'Deleted'
		};
	});
}
