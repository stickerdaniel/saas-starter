/**
 * Prints, as JSON, what the English prose workers and the inline check report for the same
 * files, named relative to one directory and read as the flat or the workspace layout does.
 * Usage: `bun prose-workers.ts <worker entry path | default> <directory> <flat | workspace> <files...>`.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { EnglishFinding } from '../../english-policy/content';
import { startProseWorkers } from '../../english-policy/workers';
import {
	englishProseFiles,
	englishProseFindings,
	FLAT_CHECK_LAYOUT,
	routesOf
} from '../../static-checks';
import { WORKSPACE_CHECK_LAYOUT } from './workspace-layout';

const [entry, directory, layout, ...names] = process.argv.slice(2);
const files = englishProseFiles(
	names,
	routesOf(layout === 'workspace' ? WORKSPACE_CHECK_LAYOUT : FLAT_CHECK_LAYOUT).proseKind
);

const settle = (findings: Promise<EnglishFinding[]>) =>
	findings.then(
		(list) => ({ labels: list.map((finding) => finding.label), findings: list }),
		(error: Error) => ({ error: error.message })
	);

const workers = startProseWorkers(
	files,
	2,
	directory!,
	entry === 'default' ? undefined : pathToFileURL(entry!)
);
console.log(
	JSON.stringify({
		workers: await settle(workers.findings()),
		inline: await settle(
			englishProseFindings(files, (file) => Bun.file(path.resolve(directory!, file)).text())
		)
	})
);
