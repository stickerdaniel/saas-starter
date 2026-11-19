/**
 * T0 spike: drives `/api/effect-spike` on a running `wrangler dev`. Two
 * concurrent requests per round; the client aborts the first after `abortMs`.
 * After the round settles it reads the ledger: no id may stay active (stranded
 * work) and no step may see another request's context.
 *
 *   EFFECT_SPIKE_FIXTURE=1 bunx varlock-wrangler dev --port 8787   # after WORKERS_CI=1 bun run build
 *   bun scripts/spike/worker-fixture.ts http://localhost:8787 [rounds]
 */
const base = process.argv[2] ?? 'http://localhost:8787';
const rounds = Number(process.argv[3] ?? 3);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const report: Array<Record<string, unknown>> = [];
for (let round = 0; round < rounds; round++) {
	const cancelledId = `cancelled-${round}`;
	const keptId = `kept-${round}`;
	const controller = new AbortController();
	const cancelled = fetch(`${base}/api/effect-spike?id=${cancelledId}&ms=2000`, {
		signal: controller.signal
	}).then(
		async (response) => ({ status: response.status, body: await response.text() }),
		(error: Error) => ({ aborted: error.name })
	);
	const kept = fetch(`${base}/api/effect-spike?id=${keptId}&ms=1000`).then(async (response) => ({
		status: response.status,
		body: await response.text()
	}));
	await sleep(300);
	controller.abort();
	const results = { cancelled: await cancelled, kept: await kept };
	// Longer than the cancelled program would have run, so a stranded fiber shows as active.
	await sleep(3000);
	const ledger = await (await fetch(`${base}/api/effect-spike?ledger=1`)).json();
	report.push({ round, ...results, ledger });
}
console.log(JSON.stringify(report, null, 2));
