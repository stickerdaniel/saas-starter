import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The standalone PR-metadata bundle embeds two packages. The producer is the source file
 * that imports each package into the bundle; the consumer is THIRD-PARTY-NOTICES.md and the
 * license file shipped beside the bundle, which must name the installed version and carry
 * the package's own license text.
 */

const ROOT = path.resolve(import.meta.dirname, '../..');
const DIRECTORY = path.join(ROOT, 'scripts/english-policy');
const read = (file: string) => readFileSync(file, 'utf8');

interface EmbeddedPackage {
	name: string;
	importer: string;
	licenseFile: string;
	spdx: string;
	attribution: (version: string) => string;
}

const EMBEDDED: EmbeddedPackage[] = [
	{
		name: 'eld',
		importer: 'classifier.ts',
		licenseFile: 'ELD-LICENSE.txt',
		spdx: 'Apache-2.0',
		attribution: (version) => `Efficient Language Detector (ELD) ${version} by Nito T.M.`
	},
	{
		name: 'marked',
		importer: 'markdown.ts',
		licenseFile: 'MARKED-LICENSE.txt',
		spdx: 'MIT',
		attribution: (version) => `Marked ${version} by MarkedJS`
	}
];

interface Shipped {
	importer: string;
	notices: string;
	license: string;
}

const shipped = (embedded: EmbeddedPackage): Shipped => ({
	importer: read(path.join(DIRECTORY, embedded.importer)),
	notices: read(path.join(DIRECTORY, 'THIRD-PARTY-NOTICES.md')),
	license: read(path.join(DIRECTORY, embedded.licenseFile))
});

/** Every way the shipped notice and license disagree with the installed package. */
function noticeProblems(embedded: EmbeddedPackage, files: Shipped): string[] {
	const packageDirectory = path.join(ROOT, 'node_modules', embedded.name);
	const manifest = JSON.parse(read(path.join(packageDirectory, 'package.json'))) as {
		version: string;
		license: string;
		files?: string[];
	};
	const problems: string[] = [];
	if (!new RegExp(`from '${embedded.name}(?:/[\\w-]+)?'`).test(files.importer)) {
		problems.push(`${embedded.importer} does not import ${embedded.name}`);
	}
	if (manifest.license !== embedded.spdx) problems.push(`${embedded.name} is ${manifest.license}`);
	if (files.license !== read(path.join(packageDirectory, 'LICENSE'))) {
		problems.push(`${embedded.licenseFile} differs from the package LICENSE`);
	}
	if (!files.notices.includes(embedded.attribution(manifest.version))) {
		problems.push(`notices lack ${embedded.attribution(manifest.version)}`);
	}
	if (!files.notices.includes(embedded.licenseFile)) {
		problems.push(`notices do not name ${embedded.licenseFile}`);
	}
	// Apache-2.0 requires shipping a NOTICE file when the package has one.
	if (manifest.files?.includes('NOTICE') || existsSync(path.join(packageDirectory, 'NOTICE'))) {
		problems.push(`${embedded.name} ships a NOTICE the bundle does not carry`);
	}
	return problems;
}

describe('third-party notices for the PR-metadata bundle', () => {
	it.each(EMBEDDED.map((embedded) => [embedded.name, embedded] as const))(
		'ships the license and attribution for %s',
		(_name, embedded) => {
			expect(noticeProblems(embedded, shipped(embedded))).toEqual([]);
		}
	);

	it('rejects notices that name a different version', () => {
		const marked = EMBEDDED[1]!;
		const files = shipped(marked);
		const notices = files.notices.replace(/Marked \S+ by MarkedJS/, 'Marked 0.0.0 by MarkedJS');
		expect(notices).not.toBe(files.notices);
		expect(noticeProblems(marked, { ...files, notices })).toEqual([
			expect.stringMatching(/^notices lack Marked /)
		]);
	});
});
