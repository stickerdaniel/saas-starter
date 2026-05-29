import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalogInfo } from './types.ts';

const MODELS_URL = 'https://openrouter.ai/api/v1/models';

/**
 * Resolve the OpenRouter API key. Prefers the environment so the eval can run
 * from a worktree, then falls back to the project's local Convex env file.
 */
export function loadOpenRouterApiKey(): string {
	const fromEnv = process.env.OPENROUTER_API_KEY?.trim();
	if (fromEnv) return fromEnv;

	const path = join(process.cwd(), '.env.convex.local');
	if (existsSync(path)) {
		for (const line of readFileSync(path, 'utf8').split('\n')) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			const eq = trimmed.indexOf('=');
			if (eq < 0 || trimmed.slice(0, eq).trim() !== 'OPENROUTER_API_KEY') continue;
			let val = trimmed.slice(eq + 1).trim();
			if (
				(val.startsWith('"') && val.endsWith('"')) ||
				(val.startsWith("'") && val.endsWith("'"))
			) {
				val = val.slice(1, -1);
			}
			if (val) return val;
		}
	}
	throw new Error(
		'OPENROUTER_API_KEY not set. Export it or add it to .env.convex.local before running model:eval.'
	);
}

type OpenRouterModel = {
	id: string;
	name: string;
	architecture?: { input_modalities?: string[] };
	supported_parameters?: string[];
};

export async function fetchCatalog(): Promise<OpenRouterModel[]> {
	const res = await fetch(MODELS_URL);
	if (!res.ok) throw new Error(`OpenRouter models API failed: ${res.status}`);
	const json = (await res.json()) as { data?: OpenRouterModel[] };
	return json.data ?? [];
}

export function getCatalogEntry(models: OpenRouterModel[], modelId: string): CatalogInfo | null {
	const m = models.find((x) => x.id === modelId);
	if (!m) return null;
	const inputModalities = m.architecture?.input_modalities ?? [];
	const supportedParameters = m.supported_parameters ?? [];
	return {
		id: m.id,
		name: m.name,
		inputModalities,
		supportedParameters,
		hasTools: supportedParameters.includes('tools'),
		hasReasoning: supportedParameters.includes('reasoning'),
		hasImage: inputModalities.includes('image'),
		hasFile: inputModalities.includes('file')
	};
}
