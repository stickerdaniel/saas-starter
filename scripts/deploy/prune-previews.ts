import { checkAborted, DeploymentError, requestJson, type ExecutionControls } from './execution';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const API_BASE = 'https://api.convex.dev/v1';
const FRESHNESS_PREFERENCE_MS = 5 * 60 * 1000;

export interface Preview {
	name: string;
	previewIdentifier: string;
	createTime: number;
	expiresAt: number | null;
	/** Non-preview/unknown types are never eligible for deletion. */
	deploymentType: string;
}

export interface PruneDeps {
	list: (token: string, projectId: string, execution?: ExecutionControls) => Promise<Preview[]>;
	remove: (token: string, name: string, execution?: ExecutionControls) => Promise<void>;
}

export async function listPreviewDeployments(
	token: string,
	projectId: string,
	execution?: ExecutionControls
): Promise<Preview[]> {
	const body = await requestJson(
		`${API_BASE}/projects/${encodeURIComponent(projectId)}/list_deployments`,
		{ headers: { Authorization: `Bearer ${token}` } },
		execution
	);
	if (!Array.isArray(body)) throw new DeploymentError('request_failed', 'Invalid deployment list.');
	const previews: Preview[] = [];
	const entries: unknown[] = body;
	for (const item of entries) {
		if (!isRecord(item)) {
			throw new DeploymentError('request_failed', 'Invalid deployment list.');
		}
		// The management API lists all types. A preview identifier alone is not
		// permission to delete a deployment with a non-preview or unknown type.
		if (item.deploymentType !== 'preview') continue;
		if (
			typeof item.name !== 'string' ||
			!item.name ||
			typeof item.previewIdentifier !== 'string' ||
			!normalizeIdentifier(item.previewIdentifier) ||
			typeof item.createTime !== 'number' ||
			!Number.isFinite(item.createTime) ||
			item.createTime < 0 ||
			(item.expiresAt != null &&
				(typeof item.expiresAt !== 'number' || !Number.isFinite(item.expiresAt)))
		)
			throw new DeploymentError('request_failed', 'Invalid preview deployment.');
		previews.push({
			name: item.name,
			previewIdentifier: item.previewIdentifier,
			createTime: item.createTime,
			expiresAt: item.expiresAt ?? null,
			deploymentType: item.deploymentType
		});
	}
	return previews;
}

export async function deleteDeployment(
	token: string,
	name: string,
	execution?: ExecutionControls
): Promise<void> {
	await requestJson(
		`${API_BASE}/deployments/${encodeURIComponent(name)}/delete`,
		{ method: 'POST', headers: { Authorization: `Bearer ${token}` } },
		execution,
		'empty'
	);
}

export const previewManagement: PruneDeps = {
	list: listPreviewDeployments,
	remove: deleteDeployment
};

export function normalizeIdentifier(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

const approvedPrune: unique symbol = Symbol('approved preview prune');

export interface ApprovedPreviewPrune {
	readonly kind: 'candidate';
	readonly projectId: string;
	readonly target: Readonly<Preview>;
	readonly [approvedPrune]: true;
}

export type PreviewPrunePlan =
	| ApprovedPreviewPrune
	| {
			kind: 'no_candidate';
			reason:
				'invalid_context' | 'live_branches_unknown' | 'no_candidates' | 'ambiguous_candidates';
	  };

export interface PreviewPruneInputs {
	projectId: string;
	previews: readonly Preview[];
	currentBranch: string | null;
	currentDeployment?: string | null;
	/** null means remote state could not be established; an empty set is known empty. */
	liveBranches: ReadonlySet<string> | null;
	protectedBranches?: ReadonlySet<string>;
	protectedDeployments?: ReadonlySet<string>;
	now: number;
}

/** Pure selection. It neither lists remote state nor performs any deletion. */
export function planPreviewPrune(inputs: PreviewPruneInputs): PreviewPrunePlan {
	const { previews, now } = inputs;
	const current = normalizeIdentifier(inputs.currentBranch ?? '');
	if (!inputs.projectId || !current || !Number.isFinite(now)) {
		return { kind: 'no_candidate', reason: 'invalid_context' };
	}
	if (inputs.liveBranches === null)
		return { kind: 'no_candidate', reason: 'live_branches_unknown' };
	const protectedBranches = new Set(
		[...inputs.liveBranches, ...(inputs.protectedBranches ?? []), current].map(normalizeIdentifier)
	);
	const eligible = previews.filter((p) => p.deploymentType === 'preview');
	const names = new Set<string>();
	const identifiers = new Set<string>();
	for (const p of eligible) {
		const id = normalizeIdentifier(p.previewIdentifier);
		if (
			!p.name ||
			!id ||
			!Number.isFinite(p.createTime) ||
			p.createTime < 0 ||
			p.createTime > now ||
			names.has(p.name) ||
			identifiers.has(id) ||
			previews.filter((other) => other.name === p.name).length !== 1
		) {
			return { kind: 'no_candidate', reason: 'ambiguous_candidates' };
		}
		names.add(p.name);
		identifiers.add(id);
	}
	// Protect every newest deployment when timestamps tie, not an arbitrary one.
	const newest = Math.max(...eligible.map((p) => p.createTime));
	const candidates = eligible
		.filter(
			(p) =>
				p.name !== inputs.currentDeployment &&
				!inputs.protectedDeployments?.has(p.name) &&
				!protectedBranches.has(normalizeIdentifier(p.previewIdentifier)) &&
				p.createTime !== newest
		)
		.sort((a, b) => a.createTime - b.createTime);
	const target =
		candidates.find((p) => now - p.createTime > FRESHNESS_PREFERENCE_MS) ?? candidates[0];
	if (!target) return { kind: 'no_candidate', reason: 'no_candidates' };
	if (candidates.filter((p) => p.createTime === target.createTime).length !== 1) {
		return { kind: 'no_candidate', reason: 'ambiguous_candidates' };
	}
	return Object.freeze({
		kind: 'candidate',
		projectId: inputs.projectId,
		target: Object.freeze({ ...target }),
		[approvedPrune]: true as const
	});
}

/** Only the pure planner can construct an approved, immutable deletion target. */
export async function applyPreviewPrune(
	plan: ApprovedPreviewPrune,
	deps: { token: string; projectId: string; remove: PruneDeps['remove'] } & ExecutionControls
): Promise<{ pruned: string }> {
	checkAborted(deps.signal);
	if (
		plan?.[approvedPrune] !== true ||
		!Object.isFrozen(plan) ||
		!Object.isFrozen(plan.target) ||
		plan.projectId !== deps.projectId ||
		plan.target.deploymentType !== 'preview'
	) {
		throw new DeploymentError('prune_blocked', 'Preview deletion requires an approved plan.');
	}
	await deps.remove(deps.token, plan.target.name, {
		signal: deps.signal,
		timeoutMs: deps.timeoutMs
	});
	return { pruned: plan.target.name };
}

export type DeleteByBranchResult =
	| { deleted: string }
	| { deleted: null; reason: 'not_found' | 'ambiguous' | 'invalid_branch' | 'invalid_target' };

/** The PR-close path is exact-match deletion, not quota-recovery selection. */
export async function deletePreviewForBranch(args: {
	token: string;
	projectId: string;
	gitRef: string;
	deps?: PruneDeps;
	execution?: ExecutionControls;
}): Promise<DeleteByBranchResult> {
	const deps = args.deps ?? previewManagement;
	const wanted = normalizeIdentifier(args.gitRef);
	if (!wanted) return { deleted: null, reason: 'invalid_branch' };
	checkAborted(args.execution?.signal);
	const previews = await deps.list(args.token, args.projectId, args.execution);
	const matches = previews.filter((p) => normalizeIdentifier(p.previewIdentifier) === wanted);
	const target = matches[0];
	if (!target) return { deleted: null, reason: 'not_found' };
	if (matches.length !== 1) return { deleted: null, reason: 'ambiguous' };
	if (
		!target.name ||
		!target.previewIdentifier ||
		target.deploymentType !== 'preview' ||
		previews.filter((p) => p.name === target.name).length !== 1
	) {
		return { deleted: null, reason: 'invalid_target' };
	}
	checkAborted(args.execution?.signal);
	await deps.remove(args.token, target.name, args.execution);
	return { deleted: target.name };
}
