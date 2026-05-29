#!/usr/bin/env bun
/**
 * Local model capability eval. Checks whether an OpenRouter model supports
 * everything the app asks of its chat models: streaming text, reasoning traces,
 * image input, PDF input, and tool calling. Each capability is verified through
 * the app's own message-materialization pipeline, so a pass means the output
 * actually renders in the chat UI, not just that bytes came back.
 *
 * Not CI. Burns OpenRouter credits. Needs OPENROUTER_API_KEY (env or
 * .env.convex.local).
 *
 *   bun run model:eval                                 # check the model in use (CHAT_MODEL_ID)
 *   bun run model:eval -- --model openai/gpt-5-mini    # check a candidate
 *   bun run model:eval -- --model a --model b          # compare several
 *   bun run model:eval -- --json /tmp/eval.json        # also write raw results
 */
import { writeFileSync } from 'node:fs';
import { CHAT_MODEL_ID } from '../src/lib/convex/utils/chatModel.ts';
import {
	checkCatalog,
	checkImage,
	checkPdf,
	checkReasoning,
	checkText,
	checkTools
} from './model-eval/checks.ts';
import { imageMessages, pdfMessages, textMessages, toolsMessages } from './model-eval/fixtures.ts';
import { runProbe } from './model-eval/harness.ts';
import { fetchCatalog, getCatalogEntry, loadOpenRouterApiKey } from './model-eval/openrouter.ts';
import { allUsable, printDetails, printMatrix, printSummary } from './model-eval/report.ts';
import type { Capability, CatalogInfo, ModelReport, Verdict } from './model-eval/types.ts';

const PROBE_TIMEOUT_MS = 90_000;

function parseArgs(argv: string[]): { models: string[]; jsonPath: string | null } {
	const models: string[] = [];
	let jsonPath: string | null = null;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--model' && argv[i + 1]) models.push(argv[++i]!);
		else if (argv[i] === '--json' && argv[i + 1]) jsonPath = argv[++i]!;
	}
	if (models.length === 0) models.push(CHAT_MODEL_ID);
	return { models, jsonPath };
}

function failVerdicts(caps: Capability[], err: unknown): Verdict[] {
	const msg = err instanceof Error ? err.message : String(err);
	return caps.map((capability) => ({ capability, status: 'fail', notes: [msg], ms: null }));
}

async function evalModel(model: string, catalog: CatalogInfo | null): Promise<ModelReport> {
	// One probe per surface; text drives both the text and reasoning columns.
	const text = runProbe(model, { messages: textMessages(), withTools: false }, PROBE_TIMEOUT_MS)
		.then((r): Verdict[] => [checkText(r.materialized, r.ms), checkReasoning(r.materialized, r.ms)])
		.catch((e): Verdict[] => failVerdicts(['text', 'reasoning'], e));

	const image = runProbe(model, { messages: imageMessages(), withTools: false }, PROBE_TIMEOUT_MS)
		.then((r): Verdict[] => [checkImage(r.materialized, r.ms)])
		.catch((e): Verdict[] => failVerdicts(['image'], e));

	const pdf = runProbe(model, { messages: pdfMessages(), withTools: false }, PROBE_TIMEOUT_MS)
		.then((r): Verdict[] => [checkPdf(r.materialized, r.ms, catalog)])
		.catch((e): Verdict[] => failVerdicts(['pdf'], e));

	const tools = runProbe(model, { messages: toolsMessages(), withTools: true }, PROBE_TIMEOUT_MS)
		.then((r): Verdict[] => [checkTools(r.materialized, r.ms)])
		.catch((e): Verdict[] => failVerdicts(['tools'], e));

	const grouped = await Promise.all([text, image, pdf, tools]);
	const verdicts: Verdict[] = [checkCatalog(catalog), ...grouped.flat()];
	return { model, catalog, verdicts, error: null };
}

async function main() {
	const { models, jsonPath } = parseArgs(process.argv.slice(2));
	process.env.OPENROUTER_API_KEY = loadOpenRouterApiKey();

	console.log('Model capability eval (OpenRouter)');
	console.log(`Models: ${models.join(', ')}`);

	const catalogList = await fetchCatalog();
	const reports = await Promise.all(
		models.map((model) => evalModel(model, getCatalogEntry(catalogList, model)))
	);

	printMatrix(reports);
	printDetails(reports);
	printSummary(reports);

	if (jsonPath) {
		writeFileSync(jsonPath, JSON.stringify({ models, reports }, null, 2));
		console.log(`\nWrote ${jsonPath}`);
	}

	process.exit(allUsable(reports) ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
