/**
 * Prints, as JSON, what the English prose workers and the inline check report for the same
 * files. Usage: `bun prose-workers.ts <worker entry path | default> <files...>`.
 */
import { pathToFileURL } from 'node:url';
import type { EnglishFinding } from '../../english-policy/content';
import { startProseWorkers } from '../../english-policy/workers';
import { englishProseFindings } from '../../static-checks';

const [entry, ...files] = process.argv.slice(2);

const settle = (findings: Promise<EnglishFinding[]>) =>
	findings.then(
		(list) => ({ labels: list.map((finding) => finding.label) }),
		(error: Error) => ({ error: error.message })
	);

const workers = startProseWorkers(
	files,
	2,
	entry === 'default' ? undefined : pathToFileURL(entry!)
);
console.log(
	JSON.stringify({
		workers: await settle(workers.findings()),
		inline: await settle(englishProseFindings(files))
	})
);
