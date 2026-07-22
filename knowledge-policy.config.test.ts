import { describe, expect, it } from 'vitest';
import knowledgePolicy from './knowledge-policy.config';
import { evaluateKnowledgePolicy, type PolicyRepository } from './scripts/knowledge-policy/policy';

function repository(entries: Record<string, string>): PolicyRepository {
	return {
		files: Object.keys(entries),
		readText: (file) => entries[file] ?? '',
		pathExists: (file) => Object.hasOwn(entries, file),
		commitExists: () => false
	};
}

function run(entries: Record<string, string>) {
	return evaluateKnowledgePolicy({ policy: knowledgePolicy, repository: repository(entries) });
}

describe('saas-starter knowledge policy', () => {
	it('allows project-specific documentation without a global allowlist', () => {
		expect(
			run({
				'README.md': '# Template',
				'CONTRIBUTING.md': '# Contribution guide',
				'docs/ARCHITECTURE.md': '# Architecture',
				'docs/api/public-api.md': '# API',
				'src/lib/components/example/README.md': '# Component guide'
			})
		).toEqual([]);
	});

	it('validates decision and runbook metadata when those directories are used', () => {
		expect(
			run({
				'docs/decisions/2026-07-22-example.md':
					'---\ntype: decision\ndate: 2026-07-22\nstatus: historical\nsnapshot: abcdef0\n---\n',
				'docs/runbooks/provider.md': '---\ntype: runbook\nsystem: provider\n---\n'
			})
		).toEqual([]);

		const findings = run({
			'docs/decisions/2026-07-22-example.md':
				'---\ntype: note\ndate: 2026-07-21\nstatus: current\nsnapshot: not-a-sha\n---\n',
			'docs/runbooks/provider.md': '---\ntype: note\nsystem:\n---\n'
		});
		expect(findings.map((finding) => finding.ruleId)).toEqual([
			'knowledge.decision-type',
			'knowledge.decision-date',
			'knowledge.decision-status',
			'knowledge.decision-snapshot',
			'knowledge.runbook-type',
			'knowledge.runbook-system'
		]);
	});

	it('checks relative links but ignores vendored skill documentation', () => {
		const findings = run({
			'README.md': '[missing](docs/missing.md)',
			'skills/example/SKILL.md': '[reference](reference/not-installed.md)'
		});
		expect(findings).toMatchObject([
			{ ruleId: 'knowledge.relative-link-missing', file: 'README.md' }
		]);
	});
});
