import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const BUDGET_FILE = 'lighthouse-budget.json';
const LIGHTHOUSE = 'lighthouse@12.8.2';
const PAGE = '/en';
const ATTEMPTS = 3;
const ATTEMPT_MS = 180_000;
const MIN_ATTEMPT_MS = 60_000;

const METRICS = {
	'first-contentful-paint': { label: 'FCP', unit: ' ms' },
	'largest-contentful-paint': { label: 'LCP', unit: ' ms' },
	'total-blocking-time': { label: 'TBT', unit: ' ms' },
	'cumulative-layout-shift': { label: 'CLS', unit: '' },
	'speed-index': { label: 'SI', unit: ' ms' }
} as const;
type Metric = keyof typeof METRICS;
const METRIC_IDS = Object.keys(METRICS) as Metric[];

const FORM_FACTORS = {
	desktop: ['--preset=desktop'],
	mobile: []
} as const satisfies Record<string, readonly string[]>;
type FormFactor = keyof typeof FORM_FACTORS;

export interface Sample {
	score: number;
	metrics: Record<Metric, number>;
}

export interface FormFactorBudget {
	minScore: number;
	max: Record<Metric, number>;
}

type LighthouseBudget = Record<FormFactor, FormFactorBudget>;

const LANDING_INDEPENDENT = [
	/^docs\//,
	/^(?!src\/).*\.md$/,
	/^e2e\//,
	/^(?!src\/).*\.(?:test|spec)\.ts$/,
	/^(?!src\/)(?:.*\/)?test-fixtures\//,
	/^\.github\/(?!workflows\/e2e-preview-cf\.yml$)/
];

export const canChangeLanding = (files: readonly string[]) =>
	files.some((file) => !LANDING_INDEPENDENT.some((pattern) => pattern.test(file)));

export function median(values: readonly number[]): number {
	if (values.length === 0) throw new Error('Expected at least one value');
	const sorted = values.toSorted((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

const mapMetrics = (value: (id: Metric) => number) =>
	Object.fromEntries(METRIC_IDS.map((id) => [id, value(id)])) as Record<Metric, number>;

export const summarize = (samples: readonly Sample[]): Sample => ({
	score: median(samples.map(({ score }) => score)),
	metrics: mapMetrics((id) => median(samples.map(({ metrics }) => metrics[id])))
});

const plain = (id: Metric, value: number) =>
	id === 'cumulative-layout-shift' ? value.toFixed(3) : String(Math.round(value));
const format = (id: Metric, value: number) => `${plain(id, value)}${METRICS[id].unit}`;

export function breaches(measured: Sample, budget: FormFactorBudget): string[] {
	const score =
		measured.score < budget.minScore ? [`score ${measured.score} < ${budget.minScore}`] : [];
	const metrics = METRIC_IDS.filter((id) => measured.metrics[id] > budget.max[id]).map(
		(id) =>
			`${METRICS[id].label} ${format(id, measured.metrics[id])} > ${format(id, budget.max[id])}`
	);
	return [...score, ...metrics];
}

interface LighthouseReport {
	runtimeError?: { code: string; message: string };
	mainDocumentUrl?: string;
	finalDisplayedUrl?: string;
	categories: { performance?: { score: number | null } };
	audits: Record<string, { numericValue?: number } | undefined>;
}

function readSample(file: string, url: string): Sample | string {
	const report: LighthouseReport = JSON.parse(fs.readFileSync(file, 'utf8'));
	if (report.runtimeError) return `${report.runtimeError.code}: ${report.runtimeError.message}`;
	for (const landed of [report.mainDocumentUrl, report.finalDisplayedUrl])
		if (landed !== url) return `audited ${landed ?? 'no URL'} instead of ${url}`;
	const score = report.categories.performance?.score;
	if (score === null || score === undefined) return 'no performance score';
	const missing = METRIC_IDS.filter((id) => report.audits[id]?.numericValue === undefined);
	if (missing.length > 0) return `no value for ${missing.join(', ')}`;
	return {
		score: Math.round(score * 100),
		metrics: mapMetrics((id) => report.audits[id]!.numericValue!)
	};
}

function audit(
	url: string,
	formFactor: FormFactor,
	run: number,
	outDir: string,
	deadline: number
): Sample {
	const chromeFlags = ['--headless=new', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])];
	for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
		const remaining = deadline - Date.now();
		if (remaining < MIN_ATTEMPT_MS)
			throw new Error(`deadline reached before ${formFactor} run ${run}, attempt ${attempt}`);
		const base = path.join(outDir, `${formFactor}-${run}-${attempt}`);
		const report = `${base}.report.json`;
		for (const output of [report, `${base}.report.html`]) fs.rmSync(output, { force: true });
		const result = spawnSync(
			process.execPath,
			[
				'x',
				LIGHTHOUSE,
				url,
				...FORM_FACTORS[formFactor],
				'--only-categories=performance',
				'--output=json',
				'--output=html',
				`--output-path=${base}`,
				`--chrome-flags=${chromeFlags.join(' ')}`,
				'--quiet'
			],
			{ stdio: ['ignore', 'inherit', 'inherit'], timeout: Math.min(ATTEMPT_MS, remaining) }
		);
		const sample = fs.existsSync(report) ? readSample(report, url) : 'no report';
		const outcome =
			result.status === 0
				? sample
				: `exit ${result.status ?? result.signal ?? result.error?.message}${typeof sample === 'string' ? `, ${sample}` : ''}`;
		if (typeof outcome !== 'string') return outcome;
		console.warn(`[lighthouse-budget] ${formFactor} run ${run}, attempt ${attempt}: ${outcome}`);
	}
	throw new Error(`${formFactor} run ${run} failed ${ATTEMPTS} times`);
}

function table(formFactor: FormFactor, samples: readonly Sample[], budget: FormFactorBudget) {
	const measured = summarize(samples);
	const runs = samples.map(({ score }) => score).join(', ');
	return [
		`| ${formFactor} | median | runs | budget |`,
		'| --- | --- | --- | --- |',
		`| Score | ${measured.score} | ${runs} | >= ${budget.minScore} |`,
		...METRIC_IDS.map((id) => {
			const runs = samples.map(({ metrics }) => plain(id, metrics[id])).join(', ');
			return `| ${METRICS[id].label} | ${format(id, measured.metrics[id])} | ${runs} | <= ${format(id, budget.max[id])} |`;
		})
	].join('\n');
}

function publish(markdown: string, description: string) {
	console.log(markdown);
	if (process.env.GITHUB_STEP_SUMMARY)
		fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
	if (process.env.GITHUB_OUTPUT)
		fs.appendFileSync(process.env.GITHUB_OUTPUT, `description=${description.slice(0, 140)}\n`);
}

function readChangedFiles(file: string): string[] {
	const files: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
	if (!Array.isArray(files) || !files.every((name) => typeof name === 'string'))
		throw new Error(`${file} must hold a JSON array of file names`);
	return files;
}

async function servedVersion(origin: string): Promise<unknown> {
	const response = await fetch(new URL('/_app/version.json', origin), {
		redirect: 'error',
		headers: { 'cache-control': 'no-cache' },
		signal: AbortSignal.timeout(20_000)
	});
	if (!response.ok) throw new Error(`${origin}/_app/version.json returned HTTP ${response.status}`);
	const body: unknown = await response.json();
	return typeof body === 'object' && body !== null && 'version' in body ? body.version : undefined;
}

async function main(): Promise<{ markdown: string; description: string; passed: boolean }> {
	const { values } = parseArgs({
		options: {
			url: { type: 'string' },
			'expect-sha': { type: 'string' },
			runs: { type: 'string', default: '5' },
			out: { type: 'string', default: 'lighthouse-reports' },
			'changed-files': { type: 'string' },
			unavailable: { type: 'string' },
			'deadline-minutes': { type: 'string', default: '13' }
		}
	});
	const minutes = Number(values['deadline-minutes']);
	if (!(minutes > 0)) throw new Error('--deadline-minutes must be a positive number');
	const deadline = Date.now() + minutes * 60_000;
	if (values['changed-files'] !== undefined) {
		const files = readChangedFiles(values['changed-files']);
		if (!canChangeLanding(files))
			return {
				markdown: `Lighthouse skipped: none of the ${files.length} changed files can change ${PAGE}.`,
				description: `Skipped (${files.length} changed files cannot change ${PAGE})`,
				passed: true
			};
	}
	if (values.unavailable !== undefined) throw new Error(`no audit target: ${values.unavailable}`);
	if (!values.url) throw new Error('Missing --url');
	const runs = Number(values.runs);
	if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');
	const url = new URL(PAGE, values.url).href;
	if (values['expect-sha'] !== undefined) {
		const served = await servedVersion(values.url);
		if (served !== values['expect-sha'])
			throw new Error(
				`${values.url} serves ${JSON.stringify(served)}, not ${values['expect-sha']}`
			);
	}
	const budget: LighthouseBudget = JSON.parse(
		fs.readFileSync(path.join(process.cwd(), BUDGET_FILE), 'utf8')
	);
	fs.mkdirSync(values.out, { recursive: true });

	const results = (Object.keys(FORM_FACTORS) as FormFactor[]).map((formFactor) => {
		const samples = Array.from({ length: runs }, (_, index) =>
			audit(url, formFactor, index + 1, values.out, deadline)
		);
		const measured = summarize(samples);
		return {
			formFactor,
			measured,
			failures: breaches(measured, budget[formFactor]),
			markdown: table(formFactor, samples, budget[formFactor])
		};
	});

	const failures = results.flatMap(({ formFactor, failures }) =>
		failures.map((failure) => `${formFactor} ${failure}`)
	);
	const medians = results
		.map(
			({ formFactor, measured }) =>
				`${formFactor} ${measured.score} FCP ${plain('first-contentful-paint', measured.metrics['first-contentful-paint'])} LCP ${plain('largest-contentful-paint', measured.metrics['largest-contentful-paint'])}`
		)
		.join(', ');
	const verdict = failures.length > 0 ? `Over budget: ${failures.join('; ')}` : medians;
	return {
		markdown: [
			`Lighthouse ${url}, median of ${runs} runs per form factor`,
			...results.map(({ markdown }) => markdown),
			failures.length > 0 ? verdict : `Within ${BUDGET_FILE}.`
		].join('\n\n'),
		description: verdict,
		passed: failures.length === 0
	};
}

if (import.meta.main) {
	const outcome = await main().catch((error: Error) => ({
		markdown: `Lighthouse audit failed: ${error.message}`,
		description: `Audit failed: ${error.message}`,
		passed: false
	}));
	publish(outcome.markdown, outcome.description);
	process.exit(outcome.passed ? 0 : 1);
}
