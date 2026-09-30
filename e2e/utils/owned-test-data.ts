import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const directory = join(process.cwd(), 'e2e', '.auth');
const file = join(directory, 'owned-test-data.json');
export interface OwnedTestData {
	runId: string;
	recipientEmails: string[];
	userEmails: string[];
}

export function readOwnedTestData(): OwnedTestData | undefined {
	return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as OwnedTestData) : undefined;
}
export function beginOwnedTestData(): string {
	if (readOwnedTestData())
		throw new Error(
			'Unfinished E2E cleanup: recover e2e/.auth/owned-test-data.json before starting another run'
		);
	mkdirSync(directory, { recursive: true });
	const runId = randomUUID();
	writeFileSync(file, JSON.stringify({ runId, recipientEmails: [], userEmails: [] }));
	return runId;
}
export function ownTestEmail(
	email: string,
	kind: 'recipientEmails' | 'userEmails' = 'recipientEmails'
) {
	if (!email.endsWith('@e2e.example.com')) throw new Error('Only E2E emails may be owned');
	const data = readOwnedTestData();
	if (!data) throw new Error('E2E ownership was not initialized');
	if (!data[kind].includes(email)) data[kind].push(email);
	writeFileSync(file, JSON.stringify(data));
}
export function finishOwnedTestData() {
	unlinkSync(file);
}
