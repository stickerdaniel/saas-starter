import { describe, expect, it } from 'vitest';
import schema from '../../schema';
import { auditLogMetadataValidator } from './queries';

/**
 * Regression guard: the adminAuditLogs.metadata union is declared twice — once
 * in schema.ts (the table definition, what the writer stores) and once as
 * auditLogMetadataValidator in queries.ts (what the reader returns and the
 * frontend renders). A variant added to one but not the other would let a
 * writer persist a shape the reader can't type. This test compares the
 * structural JSON of both, order-independent, so they can never silently drift.
 */
function normalizeUnion(validator: { isOptional: string }): {
	optional: boolean;
	members: string[];
} {
	// `.json` is a runtime getter on every validator but is intentionally absent
	// from the public TS type, so read it through a narrow cast.
	const json = (validator as unknown as { json: { type: string; value?: unknown[] } }).json;
	const members =
		json.type === 'union' && Array.isArray(json.value)
			? json.value.map((member) => JSON.stringify(member)).sort()
			: [JSON.stringify(json)];
	return { optional: validator.isOptional === 'optional', members };
}

describe('adminAuditLogs.metadata union', () => {
	it('stays structurally in sync between schema.ts and queries.ts', () => {
		const schemaMetadata = schema.tables.adminAuditLogs.validator.fields.metadata;
		expect(normalizeUnion(schemaMetadata)).toEqual(normalizeUnion(auditLogMetadataValidator));
	});
});
