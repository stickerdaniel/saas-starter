export type MorphTarget = { kind: 'project'; id: string } | { kind: 'task'; id: string };

export function getMorphTargetIndex(kind: MorphTarget['kind']) {
	switch (kind) {
		case 'project':
			return 'by_target_project' as const;
		case 'task':
			return 'by_target_task' as const;
	}
}

export function parseMorphTarget(value: string): MorphTarget | null {
	const [kind, id] = value.split(':');
	if (!id) return null;
	if (kind === 'project') return { kind: 'project', id };
	if (kind === 'task') return { kind: 'task', id };
	return null;
}
