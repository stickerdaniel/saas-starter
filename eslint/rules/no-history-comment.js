/**
 * ESLint rule: no-history-comment
 *
 * Reports a comment that narrates the code's history with one of the five
 * constructions in CONSTRUCTIONS: an abandoned attempt, a failed approach, a
 * review finding, the state before a change, and an issue that fixed or broke
 * the code. A comment states how the code works, how to use it, or a
 * constraint the code cannot show; history belongs in the commit message or the
 * PR body, where it stays true.
 *
 * The rule reads comment tokens only, never strings: script comments in
 * JavaScript, TypeScript and Svelte, and `<!-- -->` markup comments in Svelte.
 * Adjacent line comments are read as one block, so a construction split across
 * two lines still matches. Svelte style bodies reach no ESLint rule.
 *
 * Example: // One attempt: the provider rejects a repeated idempotency key.
 */

const CONSTRUCTIONS = [
	/\bwe tried\b/i,
	/\bdid(?: not|n['’]t) work\b/i,
	/\bthe (?:review|audit) (?:found|showed|caught)\b/i,
	/\bbefore this (?:fix|change)\b/i,
	/\b(?:fixes|fixed|regressed) in #\d+/i
];

/** Comment text without delimiters, leading `*` gutters and line breaks. */
function prose(value) {
	return value
		.split('\n')
		.map((line) => line.replace(/^\s*\*?/, ''))
		.join(' ')
		.replace(/\s+/g, ' ');
}

/** Groups consecutive line comments with nothing but whitespace between them. */
function blocks(comments, text) {
	const groups = [];
	for (const comment of comments) {
		const last = groups.at(-1);
		const previous = last?.comments.at(-1);
		if (
			previous &&
			previous.type === 'Line' &&
			comment.type === 'Line' &&
			comment.loc.start.line === previous.loc.end.line + 1 &&
			text.slice(previous.range[1], comment.range[0]).trim() === ''
		) {
			last.comments.push(comment);
		} else {
			groups.push({ comments: [comment] });
		}
	}
	return groups;
}

export default {
	meta: {
		type: 'suggestion',
		docs: {
			description: 'Keep code history out of comments'
		},
		schema: [],
		messages: {
			historyComment:
				'"{{phrase}}" narrates history. A comment states how the code works, how to use it, or a constraint the code cannot show; put history in the commit message or the PR body.'
		}
	},
	create(context) {
		const { sourceCode } = context;
		const markupComments = [];

		function check(group) {
			const text = group.comments.map((comment) => prose(comment.value)).join(' ');
			for (const construction of CONSTRUCTIONS) {
				const match = construction.exec(text);
				if (!match) continue;
				context.report({
					loc: {
						start: group.comments[0].loc.start,
						end: group.comments.at(-1).loc.end
					},
					messageId: 'historyComment',
					data: { phrase: match[0] }
				});
				return;
			}
		}

		return {
			SvelteHTMLComment(node) {
				markupComments.push({
					type: 'Markup',
					value: node.value,
					loc: node.loc,
					range: node.range
				});
			},
			'Program:exit'() {
				const comments = [...sourceCode.getAllComments(), ...markupComments].sort(
					(a, b) => a.range[0] - b.range[0]
				);
				for (const group of blocks(comments, sourceCode.text)) check(group);
			}
		};
	}
};
