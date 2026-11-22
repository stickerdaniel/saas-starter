import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkProfileParity, checkSchemaParity } from './confect-parity';
import { CONFECT_DIR, CONVEX_DIR } from './confect-codegen';

const REPOSITORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function editing(file: string, from: string, to: string): (scratch: string) => void {
	return (scratch) => {
		const target = path.join(scratch, file);
		const source = readFileSync(target, 'utf8');
		if (!source.includes(from)) throw new Error(`${file} no longer contains ${from}`);
		writeFileSync(target, source.replace(from, to));
	};
}

describe('Confect schema parity', () => {
	it('generates the authored deployment schema from the Confect tables', async () => {
		const parity = await checkSchemaParity(REPOSITORY);

		expect(parity.differences).toEqual([]);
	}, 120_000);

	it('reports a changed index', async () => {
		const parity = await checkSchemaParity(REPOSITORY, {
			prepare: editing(
				`${CONFECT_DIR}/tables/adminAuditLogs.ts`,
				".index('by_admin', ['adminUserId'])",
				".index('by_admin', ['targetUserId'])"
			)
		});

		expect(parity.differences.join('\n')).toContain('$.tables[adminAuditLogs].indexes[by_admin]');
	}, 120_000);

	it('reports a dropped optional', async () => {
		const parity = await checkSchemaParity(REPOSITORY, {
			prepare: editing(
				`${CONFECT_DIR}/tables/messages.ts`,
				'quotaSettledAt: Schema.optional(Schema.Number)',
				'quotaSettledAt: Schema.Number'
			)
		});

		expect(parity.differences.join('\n')).toContain(
			'$.tables[messages].documentType.value.quotaSettledAt.optional'
		);
	}, 120_000);

	it('reports a renamed search filter field', async () => {
		const parity = await checkSchemaParity(REPOSITORY, {
			prepare: editing(
				`${CONFECT_DIR}/tables/supportThreads.ts`,
				"filterFields: ['status', 'assignedTo', 'isHandedOff', 'awaitingAdminResponse']",
				"filterFields: ['status', 'assignedTo', 'isHandedOff']"
			)
		});

		expect(parity.differences.join('\n')).toContain(
			'$.tables[supportThreads].searchIndexes[search_all].filterFields'
		);
	}, 120_000);
});

describe('Confect codegen capability profiles', () => {
	it('generates the same output for the local and test profiles', async () => {
		expect(await checkProfileParity(REPOSITORY)).toEqual([]);
	}, 120_000);

	it('reports a component that only one profile installs', async () => {
		const differences = await checkProfileParity(REPOSITORY, {
			prepare: editing(
				`${CONVEX_DIR}/convex.config.ts`,
				'export default app;',
				"if (process.env.CAPABILITY_PROFILE === 'test') app.use(rateLimiter, { name: 'testOnly' });\nexport default app;"
			)
		});

		expect(differences).toContain('src/lib/confect/_generated/components.ts');
	}, 120_000);
});
