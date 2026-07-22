import {
	allOf,
	anyOf,
	blocking,
	defineKnowledgePolicy,
	exactPaths,
	fileExtension,
	isoDateValue,
	literalValue,
	nonEmptyValue,
	not,
	oneOfValues,
	pathMatches,
	patternValue,
	underPath,
	type MetadataValidator
} from './scripts/knowledge-policy/policy';

const markdown = fileExtension('.md');
const textFile = fileExtension('.md', '.js', '.ts', '.svelte', '.html', '.css');
const policyRuntime = anyOf(
	exactPaths('knowledge-policy.config.ts'),
	underPath('scripts/knowledge-policy')
);
const ignored = anyOf(
	underPath('references'),
	underPath('node_modules'),
	underPath('.git'),
	underPath('.svelte-kit'),
	underPath('.convex'),
	underPath('build'),
	underPath('dist'),
	underPath('coverage')
);
const skillDocumentation = anyOf(
	underPath('skills'),
	underPath('.agents/skills'),
	underPath('.claude/skills')
);
const decisionPath = pathMatches(/^docs\/decisions\/\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/);
const runbookPath = pathMatches(/^docs\/runbooks\/[a-z0-9-]+\.md$/);

const dateMatchesFilename: MetadataValidator = (value, context) => {
	const date = context.file.match(/^docs\/decisions\/(\d{4}-\d{2}-\d{2})-/)?.[1];
	return value === date ? null : `Must match the filename date ${date ?? '(missing)'}.`;
};

const optionalSnapshot: MetadataValidator = (value, context) =>
	value === undefined
		? null
		: patternValue(/^[0-9a-f]{7,40}$/, 'be a 7 to 40 character lowercase commit ID')(
				value,
				context
			);

export default defineKnowledgePolicy({
	mode: 'strict',
	repository: {
		candidates: textFile,
		ignore: ignored,
		runtimeFiles: policyRuntime
	},
	documents: {
		markdown,
		allowed: [
			{
				id: 'decision',
				match: decisionPath,
				severity: blocking,
				frontmatter: {
					required: true,
					requirements: [
						{
							ruleId: 'knowledge.decision-type',
							field: 'type',
							validate: literalValue('decision')
						},
						{
							ruleId: 'knowledge.decision-date',
							field: 'date',
							validate: (value, context) =>
								isoDateValue()(value, context) ?? dateMatchesFilename(value, context)
						},
						{
							ruleId: 'knowledge.decision-status',
							field: 'status',
							validate: oneOfValues('historical', 'deprecated')
						},
						{
							ruleId: 'knowledge.decision-snapshot',
							field: 'snapshot',
							validate: optionalSnapshot
						}
					]
				}
			},
			{
				id: 'runbook',
				match: runbookPath,
				severity: blocking,
				frontmatter: {
					required: true,
					requirements: [
						{
							ruleId: 'knowledge.runbook-type',
							field: 'type',
							validate: literalValue('runbook')
						},
						{
							ruleId: 'knowledge.runbook-system',
							field: 'system',
							validate: nonEmptyValue()
						}
					]
				}
			},
			{
				id: 'documentation',
				match: allOf(markdown, not(anyOf(decisionPath, runbookPath))),
				severity: blocking
			}
		],
		forbidden: []
	},
	links: {
		include: markdown,
		exclude: skillDocumentation,
		severity: blocking
	},
	textRules: []
});
