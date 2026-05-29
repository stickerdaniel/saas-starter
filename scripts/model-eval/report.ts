import { CAPABILITIES, type Capability, type ModelReport, type VerdictStatus } from './types.ts';

const STATUS_CELL: Record<VerdictStatus, string> = {
	pass: 'PASS',
	fail: 'FAIL',
	warn: 'WARN',
	skip: ' -- '
};

const COLUMN_HEAD: Record<Capability, string> = {
	catalog: 'catalog',
	text: 'text',
	reasoning: 'reason',
	image: 'image',
	pdf: 'pdf',
	tools: 'tools'
};

function pad(s: string, width: number): string {
	return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function cell(report: ModelReport, capability: Capability): string {
	const v = report.verdicts.find((x) => x.capability === capability);
	return STATUS_CELL[v?.status ?? 'skip'];
}

/** Print the capability matrix: one row per model, one column per capability. */
export function printMatrix(reports: ModelReport[]): void {
	const modelWidth = Math.max(5, ...reports.map((r) => r.model.length));
	const header =
		pad('model', modelWidth) + '  ' + CAPABILITIES.map((c) => pad(COLUMN_HEAD[c], 8)).join('');
	console.log('\n' + header);
	console.log('-'.repeat(header.length));
	for (const report of reports) {
		const row =
			pad(report.model, modelWidth) +
			'  ' +
			CAPABILITIES.map((c) => pad(cell(report, c), 8)).join('');
		console.log(row);
	}
}

/** Print per-model notes for every capability that did not cleanly pass. */
export function printDetails(reports: ModelReport[]): void {
	for (const report of reports) {
		const problems = report.verdicts.filter((v) => v.status !== 'pass');
		if (!report.error && problems.length === 0) continue;
		console.log(`\n${report.model}`);
		if (report.error) console.log(`  run error: ${report.error}`);
		for (const v of problems) {
			const note = v.notes.length > 0 ? v.notes.join('; ') : v.status;
			console.log(`  ${pad(v.capability, 9)} ${STATUS_CELL[v.status].trim()}  ${note}`);
		}
	}
}

/** True when every model passed (or only warned on) every capability. */
export function allUsable(reports: ModelReport[]): boolean {
	return reports.every(
		(r) => !r.error && r.verdicts.every((v) => v.status === 'pass' || v.status === 'warn')
	);
}

export function printSummary(reports: ModelReport[]): void {
	const usable = reports.filter(
		(r) => !r.error && r.verdicts.every((v) => v.status === 'pass' || v.status === 'warn')
	);
	console.log(`\n${usable.length}/${reports.length} model(s) support everything the app needs.`);
}
