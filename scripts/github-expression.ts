/**
 * Evaluates the subset of GitHub Actions expressions that workflow policy tests
 * read, such as concurrency groups, against event fixtures. It follows the
 * documented semantics: loose `==` that coerces mismatched types to numbers,
 * case-insensitive string comparison, `&&`/`||` returning an operand, and
 * missing properties reading as null.
 *
 * Anything it does not model (other operators, functions, unknown contexts)
 * throws instead of guessing, so a policy test can never pass on an
 * expression this file misreads. The status functions are calls like any
 * other and are only answered for a condition given the status they read.
 * https://docs.github.com/en/actions/reference/workflows-and-actions/expressions
 */

export type ExpressionValue =
	| null
	| boolean
	| number
	| string
	| readonly ExpressionValue[]
	| { readonly [key: string]: ExpressionValue };

export type ExpressionContexts = Readonly<Record<string, ExpressionValue>>;

const STATUS_FUNCTIONS = ['always', 'success', 'failure', 'cancelled'] as const;

type StatusFunction = (typeof STATUS_FUNCTIONS)[number];

/** What success(), failure() and cancelled() return where a job or step condition is read. */
export type ConditionStatus = Readonly<Record<Exclude<StatusFunction, 'always'>, boolean>>;

type CallName = 'contains' | 'format' | StatusFunction;

type Node =
	| { kind: 'literal'; value: ExpressionValue }
	| { kind: 'context'; name: string }
	| { kind: 'property'; object: Node; key: Node }
	| { kind: 'not'; operand: Node }
	| { kind: 'binary'; operator: '==' | '!=' | '&&' | '||'; left: Node; right: Node }
	| { kind: 'call'; name: CallName; args: Node[] };

type Token =
	| { kind: 'string'; value: string }
	| { kind: 'number'; value: number }
	| { kind: 'name'; value: string }
	| { kind: 'punct'; value: string };

const FUNCTIONS = new Set<string>(['contains', 'format', ...STATUS_FUNCTIONS]);
const PUNCTUATION = ['==', '!=', '&&', '||', '!', '(', ')', '[', ']', '.', ','];

function tokenize(source: string): Token[] {
	const tokens: Token[] = [];
	let index = 0;
	while (index < source.length) {
		const rest = source.slice(index);
		const space = /^\s+/.exec(rest);
		if (space) {
			index += space[0].length;
			continue;
		}
		if (rest[0] === "'") {
			let value = '';
			let cursor = 1;
			for (;;) {
				if (cursor >= rest.length) throw new Error(`Unterminated string in ${source}`);
				if (rest[cursor] === "'") {
					if (rest[cursor + 1] !== "'") break;
					value += "'";
					cursor += 2;
				} else {
					value += rest[cursor++];
				}
			}
			tokens.push({ kind: 'string', value });
			index += cursor + 1;
			continue;
		}
		const number = /^-?\d+(?:\.\d+)?/.exec(rest);
		if (number) {
			tokens.push({ kind: 'number', value: Number(number[0]) });
			index += number[0].length;
			continue;
		}
		// Context and property names may contain dashes, as in step and output ids.
		const name = /^[A-Za-z_][\w-]*/.exec(rest);
		if (name) {
			tokens.push({ kind: 'name', value: name[0] });
			index += name[0].length;
			continue;
		}
		const punct = PUNCTUATION.find((candidate) => rest.startsWith(candidate));
		if (!punct) throw new Error(`Unmodelled syntax at "${rest}" in ${source}`);
		tokens.push({ kind: 'punct', value: punct });
		index += punct.length;
	}
	return tokens;
}

function parse(source: string): Node {
	const tokens = tokenize(source);
	let position = 0;
	const peek = (value: string) => {
		const token = tokens[position];
		return token?.kind === 'punct' && token.value === value;
	};
	const expect = (value: string) => {
		if (!peek(value)) throw new Error(`Expected "${value}" in ${source}`);
		position++;
	};

	function or(): Node {
		let left = and();
		while (peek('||')) {
			position++;
			left = { kind: 'binary', operator: '||', left, right: and() };
		}
		return left;
	}
	function and(): Node {
		let left = equality();
		while (peek('&&')) {
			position++;
			left = { kind: 'binary', operator: '&&', left, right: equality() };
		}
		return left;
	}
	function equality(): Node {
		let left = unary();
		while (peek('==') || peek('!=')) {
			const operator = peek('==') ? '==' : '!=';
			position++;
			left = { kind: 'binary', operator, left, right: unary() };
		}
		return left;
	}
	function unary(): Node {
		if (peek('!')) {
			position++;
			return { kind: 'not', operand: unary() };
		}
		return postfix();
	}
	function postfix(): Node {
		let node = primary();
		for (;;) {
			if (peek('.')) {
				position++;
				const token = tokens[position++];
				if (token?.kind !== 'name') throw new Error(`Unmodelled property access in ${source}`);
				node = { kind: 'property', object: node, key: { kind: 'literal', value: token.value } };
			} else if (peek('[')) {
				position++;
				const key = or();
				expect(']');
				node = { kind: 'property', object: node, key };
			} else {
				return node;
			}
		}
	}
	function primary(): Node {
		const token = tokens[position++];
		if (!token) throw new Error(`Unexpected end of ${source}`);
		if (token.kind === 'string' || token.kind === 'number') {
			return { kind: 'literal', value: token.value };
		}
		if (token.kind === 'punct') {
			if (token.value !== '(') throw new Error(`Unexpected "${token.value}" in ${source}`);
			const inner = or();
			expect(')');
			return inner;
		}
		if (token.value === 'true' || token.value === 'false') {
			return { kind: 'literal', value: token.value === 'true' };
		}
		if (token.value === 'null') return { kind: 'literal', value: null };
		if (!peek('(')) return { kind: 'context', name: token.value };
		if (!FUNCTIONS.has(token.value)) throw new Error(`Unmodelled function ${token.value}()`);
		position++;
		const args: Node[] = [];
		while (!peek(')')) {
			if (args.length > 0) expect(',');
			args.push(or());
		}
		position++;
		return { kind: 'call', name: token.value as CallName, args };
	}

	const tree = or();
	if (position !== tokens.length) throw new Error(`Unexpected trailing input in ${source}`);
	return tree;
}

function isObject(value: ExpressionValue): value is { readonly [key: string]: ExpressionValue } {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isTruthy(value: ExpressionValue): boolean {
	if (typeof value === 'number') return value !== 0 && !Number.isNaN(value);
	return value !== null && value !== false && value !== '';
}

function toNumber(value: ExpressionValue): number {
	if (value === null) return 0;
	if (typeof value === 'boolean') return value ? 1 : 0;
	if (typeof value === 'number') return value;
	if (typeof value === 'string') return value.trim() === '' ? 0 : Number(value);
	return Number.NaN;
}

export function toText(value: ExpressionValue): string {
	if (value === null) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'boolean' || typeof value === 'number') return String(value);
	return Array.isArray(value) ? 'Array' : 'Object';
}

function looselyEqual(left: ExpressionValue, right: ExpressionValue): boolean {
	if (typeof left === 'string' && typeof right === 'string') {
		return left.toLowerCase() === right.toLowerCase();
	}
	if (typeof left === 'object' && left !== null) return left === right;
	if (typeof right === 'object' && right !== null) return false;
	// Mismatched primitive types compare as numbers, and NaN equals nothing.
	return toNumber(left) === toNumber(right);
}

function readProperty(object: ExpressionValue, key: ExpressionValue): ExpressionValue {
	if (Array.isArray(object)) {
		return typeof key === 'number' ? (object[key] ?? null) : null;
	}
	if (!isObject(object)) return null;
	const name = toText(key).toLowerCase();
	const match = Object.keys(object).find((candidate) => candidate.toLowerCase() === name);
	return match === undefined ? null : (object[match] ?? null);
}

function format(template: string, args: ExpressionValue[]): string {
	return template.replace(/\{\{|\}\}|\{(\d+)\}|[{}]/g, (match, index: string | undefined) => {
		if (match === '{{') return '{';
		if (match === '}}') return '}';
		if (index === undefined || Number(index) >= args.length) {
			throw new Error(`Invalid format string ${template}`);
		}
		return toText(args[Number(index)]!);
	});
}

function isStatusFunction(name: CallName): name is StatusFunction {
	return (STATUS_FUNCTIONS as readonly string[]).includes(name);
}

function callsStatus(node: Node): boolean {
	switch (node.kind) {
		case 'literal':
		case 'context':
			return false;
		case 'property':
			return callsStatus(node.object) || callsStatus(node.key);
		case 'not':
			return callsStatus(node.operand);
		case 'binary':
			return callsStatus(node.left) || callsStatus(node.right);
		case 'call':
			return isStatusFunction(node.name) || node.args.some(callsStatus);
	}
}

function run(node: Node, contexts: ExpressionContexts, status?: ConditionStatus): ExpressionValue {
	switch (node.kind) {
		case 'literal':
			return node.value;
		case 'context':
			if (!Object.hasOwn(contexts, node.name)) throw new Error(`Unmodelled context ${node.name}`);
			return contexts[node.name]!;
		case 'property':
			return readProperty(run(node.object, contexts, status), run(node.key, contexts, status));
		case 'not':
			return !isTruthy(run(node.operand, contexts, status));
		case 'binary': {
			const left = run(node.left, contexts, status);
			if (node.operator === '&&') return isTruthy(left) ? run(node.right, contexts, status) : left;
			if (node.operator === '||') return isTruthy(left) ? left : run(node.right, contexts, status);
			const equal = looselyEqual(left, run(node.right, contexts, status));
			return node.operator === '==' ? equal : !equal;
		}
		case 'call': {
			if (isStatusFunction(node.name)) {
				if (!status) throw new Error(`${node.name}() is only modelled in a condition`);
				if (node.args.length > 0) throw new Error(`${node.name}() takes no arguments`);
				return node.name === 'always' || status[node.name];
			}
			const args = node.args.map((arg) => run(arg, contexts, status));
			if (node.name === 'format') {
				if (typeof args[0] !== 'string') throw new Error('format() needs a string template');
				return format(args[0], args.slice(1));
			}
			if (args.length !== 2) throw new Error('contains() takes two arguments');
			const [search, item] = args as [ExpressionValue, ExpressionValue];
			if (Array.isArray(search)) return search.some((entry) => looselyEqual(entry, item));
			return toText(search).toLowerCase().includes(toText(item).toLowerCase());
		}
	}
}

export function evaluate(expression: string, contexts: ExpressionContexts): ExpressionValue {
	return run(parse(expression), contexts);
}

/**
 * Decides whether a job or step `if` lets it run, as the runner does: an absent
 * condition means success(), the `${{ }}` wrapper is optional, and a condition
 * that calls no status function runs as `success() && (condition)`.
 * https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#status-check-functions
 */
export function runsWhen(
	condition: unknown,
	contexts: ExpressionContexts,
	status: ConditionStatus
): boolean {
	if (condition === undefined) return status.success;
	if (typeof condition === 'boolean') return status.success && condition;
	if (typeof condition !== 'string') throw new Error(`Unmodelled condition ${String(condition)}`);
	const wrapped = /^\s*\$\{\{([\s\S]*)\}\}\s*$/.exec(condition)?.[1];
	const expression = wrapped ?? condition;
	if (expression.includes('${{')) throw new Error(`Unmodelled condition ${condition}`);
	const tree = parse(expression);
	const value = isTruthy(run(tree, contexts, status));
	return callsStatus(tree) ? value : status.success && value;
}

/**
 * Resolves a workflow value the way the runner does: a value that is exactly one
 * `${{ }}` keeps the expression's result type, and any other string has each
 * expression replaced by its text. Non-string YAML values pass through.
 */
export function interpolate(value: unknown, contexts: ExpressionContexts): ExpressionValue {
	if (typeof value === 'boolean' || typeof value === 'number' || value === null) return value;
	if (typeof value !== 'string') throw new Error(`Unmodelled workflow value ${String(value)}`);
	const parts: Array<{ text: string } | { expression: string }> = [];
	let index = 0;
	while (index < value.length) {
		const start = value.indexOf('${{', index);
		if (start < 0) {
			parts.push({ text: value.slice(index) });
			break;
		}
		if (start > index) parts.push({ text: value.slice(index, start) });
		// Find the closing braces outside string literals.
		let cursor = start + 3;
		let quoted = false;
		while (cursor < value.length && (quoted || !value.startsWith('}}', cursor))) {
			if (value[cursor] === "'") quoted = !quoted;
			cursor++;
		}
		if (cursor >= value.length) throw new Error(`Unterminated expression in ${value}`);
		parts.push({ expression: value.slice(start + 3, cursor) });
		index = cursor + 2;
	}
	const [only] = parts;
	if (parts.length === 1 && only && 'expression' in only)
		return evaluate(only.expression, contexts);
	return parts
		.map((part) => ('text' in part ? part.text : toText(evaluate(part.expression, contexts))))
		.join('');
}
