import { describe, expect, it } from 'vitest';
import {
	blocking,
	defineKnowledgePolicy,
	evaluateKnowledgePolicy,
	exactPaths,
	fileExtension,
	literalValue,
	removedDocumentReferences,
	type KnowledgePolicyConfig,
	type PolicyRepository
} from './policy';

function repository(
	entries: Record<string, string>,
	commits = new Set<string>()
): PolicyRepository {
	return {
		files: Object.keys(entries),
		readText: (file) => entries[file] ?? '',
		pathExists: (file) => Object.hasOwn(entries, file),
		commitExists: (sha) => commits.has(sha)
	};
}

function policy(mode: 'advisory' | 'strict' = 'strict'): KnowledgePolicyConfig {
	const markdown = fileExtension('.md');
	return defineKnowledgePolicy({
		mode,
		repository: {
			candidates: fileExtension('.md', '.ts'),
			ignore: exactPaths('ignored.md'),
			runtimeFiles: exactPaths('knowledge-policy.config.ts')
		},
		documents: {
			markdown,
			requireClassification: blocking,
			allowed: [
				{
					id: 'decision',
					match: exactPaths('docs/decision.md', 'docs/ambiguous.md'),
					severity: blocking,
					frontmatter: {
						required: true,
						requirements: [
							{
								ruleId: 'test.type',
								field: 'type',
								validate: literalValue('decision')
							}
						]
					}
				},
				{
					id: 'navigation',
					match: exactPaths('README.md', 'docs/ambiguous.md'),
					severity: blocking
				}
			],
			forbidden: [
				{
					ruleId: 'test.forbidden',
					match: exactPaths('PLAN.md'),
					severity: blocking,
					message: 'Temporary document.'
				}
			]
		},
		links: { include: markdown, severity: blocking },
		textRules: [
			removedDocumentReferences({
				ruleId: 'test.removed',
				paths: ['OLD.md'],
				include: fileExtension('.md', '.ts'),
				severity: blocking
			})
		]
	});
}

describe('knowledge policy', () => {
	it('classifies documents, validates metadata, links, and text rules', () => {
		const findings = evaluateKnowledgePolicy({
			policy: policy(),
			repository: repository({
				'README.md': '[missing](docs/missing.md) and OLD.md',
				'docs/decision.md': '---\ntype: wrong\n---\n',
				'PLAN.md': '# Plan',
				'other.md': '# Other',
				'ignored.md': '# Ignored'
			})
		});
		expect(findings.map(({ ruleId, file, severity }) => ({ ruleId, file, severity }))).toEqual([
			{ ruleId: 'test.type', file: 'docs/decision.md', severity: 'error' },
			{ ruleId: 'knowledge.document-unclassified', file: 'other.md', severity: 'error' },
			{ ruleId: 'knowledge.document-unclassified', file: 'PLAN.md', severity: 'error' },
			{ ruleId: 'test.forbidden', file: 'PLAN.md', severity: 'error' },
			{ ruleId: 'knowledge.relative-link-missing', file: 'README.md', severity: 'error' },
			{ ruleId: 'test.removed', file: 'README.md', severity: 'error' }
		]);
	});

	it('downgrades blocking findings in advisory mode', () => {
		const findings = evaluateKnowledgePolicy({
			policy: policy('advisory'),
			repository: repository({ 'other.md': '# Other' })
		});
		expect(findings).toMatchObject([
			{ severity: 'warning', ruleId: 'knowledge.document-unclassified' }
		]);
	});

	it('reports ambiguous classes once and skips class-specific validation', () => {
		const findings = evaluateKnowledgePolicy({
			policy: policy(),
			repository: repository({ 'docs/ambiguous.md': '# Ambiguous' })
		});
		expect(findings).toMatchObject([
			{
				ruleId: 'knowledge.document-ambiguous-class',
				file: 'docs/ambiguous.md'
			}
		]);
	});

	it('rejects duplicate document and rule IDs at definition time', () => {
		const base = policy();
		expect(() =>
			defineKnowledgePolicy({
				...base,
				documents: {
					...base.documents,
					allowed: [base.documents.allowed[0]!, base.documents.allowed[0]!]
				}
			})
		).toThrow('Document class IDs must be unique');
	});
});
