const API_BASE = 'https://api.convex.dev/v1';
const FRESHNESS_PREFERENCE_MS = 5 * 60 * 1000;

export interface Preview {
	name: string;
	previewIdentifier: string;
	createTime: number;
	expiresAt: number | null;
}

export interface PruneDeps {
	list: (token: string, projectId: string) => Promise<Preview[]>;
	remove: (token: string, name: string) => Promise<void>;
}

export type PruneResult = { pruned: string } | { pruned: null; reason: string };

export async function listPreviewDeployments(token: string, projectId: string): Promise<Preview[]> {
	const res = await fetch(`${API_BASE}/projects/${projectId}/list_deployments`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (!res.ok) {
		throw new Error(`list_deployments failed: ${res.status} ${await res.text()}`);
	}
	const body = (await res.json()) as Array<{
		name: string;
		previewIdentifier: string | null;
		createTime: number;
		expiresAt?: number | null;
	}>;
	return body
		.filter((d): d is typeof d & { previewIdentifier: string } => d.previewIdentifier != null)
		.map((d) => ({
			name: d.name,
			previewIdentifier: d.previewIdentifier,
			createTime: d.createTime,
			expiresAt: d.expiresAt ?? null
		}));
}

export async function deleteDeployment(token: string, name: string): Promise<void> {
	const res = await fetch(`${API_BASE}/deployments/${name}/delete`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}` }
	});
	if (!res.ok) {
		throw new Error(`delete ${name} failed: ${res.status} ${await res.text()}`);
	}
}

export function normalizeIdentifier(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

export function selectPrunable(
	previews: Preview[],
	currentBranch: string | null,
	now: number
): Preview | null {
	if (previews.length === 0) return null;
	// Without a current branch we cannot honour the "never prune current branch"
	// safety guard. Fail safe rather than pruning blindly.
	if (!currentBranch) return null;

	const normalizedBranch = normalizeIdentifier(currentBranch);
	// If normalization collapses to an empty string, treat it as missing.
	if (!normalizedBranch) return null;

	// Compute the absolute newest from the full set so a current-branch
	// preview that is also the newest doesn't cause us to exclude a second
	// preview unnecessarily.
	const absoluteNewest = previews.reduce((a, b) => (a.createTime >= b.createTime ? a : b));
	const candidates = previews.filter((p) => {
		const isCurrentBranch = normalizeIdentifier(p.previewIdentifier) === normalizedBranch;
		const isAbsoluteNewest = p.name === absoluteNewest.name;
		return !isCurrentBranch && !isAbsoluteNewest;
	});
	if (candidates.length === 0) return null;

	const sorted = [...candidates].sort((a, b) => a.createTime - b.createTime);
	const aged = sorted.find((p) => now - p.createTime > FRESHNESS_PREFERENCE_MS);
	return aged ?? sorted[0];
}

const defaultDeps: PruneDeps = {
	list: listPreviewDeployments,
	remove: deleteDeployment
};

export async function pruneOldestPreview(args: {
	token: string;
	projectId: string;
	currentBranch: string | null;
	now?: number;
	deps?: PruneDeps;
}): Promise<PruneResult> {
	const deps = args.deps ?? defaultDeps;
	const now = args.now ?? Date.now();

	let previews: Preview[];
	try {
		previews = await deps.list(args.token, args.projectId);
	} catch (err) {
		return { pruned: null, reason: `list failed: ${errMessage(err)}` };
	}

	const target = selectPrunable(previews, args.currentBranch, now);
	if (!target) {
		return { pruned: null, reason: 'no candidates' };
	}

	try {
		await deps.remove(args.token, target.name);
	} catch (err) {
		return { pruned: null, reason: `delete failed: ${errMessage(err)}` };
	}
	return { pruned: target.name };
}

function errMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
