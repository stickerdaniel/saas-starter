import { getFunctionName } from 'convex/server';
import { compareValues, getDocumentSize, type Value } from 'convex/values';
import schema from '../../schema';

/**
 * In-memory stand-in for the slice of a Convex mutation context that journey
 * capture and erasure use, for tests that follow data across several
 * transactions. Each rule mirrors the platform:
 * - index ranges use the real schema's index fields, ordered by those fields
 *   and then `_creationTime`, with a missing field sorting first
 *   (`compareValues`), so `gte(field, 0)` excludes documents without it;
 * - a function calls `.paginate` at most once
 *   (convex-backend `async_syscall.rs`, `MultiplePaginatedDatabaseQueries`);
 * - a page that reaches `numItems` or `maximumBytesRead` (measured with
 *   `getDocumentSize`) returns `isDone: false` without looking ahead, even
 *   when it took the last row (`index_range.rs`);
 * - a `ctx.runMutation` child with `transactionLimits.bytesRead` fails once
 *   the documents it read exceed it, counting returned documents and again
 *   the document each patch or delete rewrites;
 * - a mutation that throws, including a caught `ctx.runMutation` child, leaves
 *   no writes and no scheduled functions behind;
 * - mutations run one at a time, the serial outcome OCC guarantees.
 * Platform retries, other limits and timing are out of scope (local backend
 * only).
 */

type Doc = Record<string, Value | undefined> & { _id: string; _creationTime: number };
type Table = keyof typeof schema.tables;
type Handler = (ctx: never, args: never) => Promise<unknown>;
type Registered = { _handler: Handler };
type Job = { id: number; runAt: number; name: string; args: Record<string, unknown> };
type Condition = {
	field: string;
	op: 'eq' | 'gt' | 'gte' | 'lt' | 'lte';
	value: Value | undefined;
};

const indexFields = new Map<string, string[]>();
for (const [table, definition] of Object.entries(schema.tables)) {
	for (const index of definition[' indexes']()) {
		indexFields.set(`${table}.${index.indexDescriptor}`, index.fields);
	}
}

function matches(doc: Doc, condition: Condition): boolean {
	const order = compareValues(doc[condition.field], condition.value);
	switch (condition.op) {
		case 'eq':
			return order === 0;
		case 'gt':
			return order > 0;
		case 'gte':
			return order >= 0;
		case 'lt':
			return order < 0;
		case 'lte':
			return order <= 0;
	}
}

export function createJourneyStore(
	options: {
		/** Better Auth user ids that exist. */
		users?: string[];
		/** Registered functions reachable through `runMutation`, `runQuery` and the scheduler. */
		functions?: Record<string, Registered>;
	} = {}
) {
	let tables = new Map<string, Map<string, Doc>>();
	let jobs: Job[] = [];
	let nextId = 1;
	let nextJob = 1;
	const users = new Set(options.users ?? []);
	const functions = new Map(
		Object.entries(options.functions ?? {}).map(([name, fn]) => [name, fn._handler])
	);
	/** Throws inside a write to the matching document, `times` times. */
	const faults: Array<{ id: string; remaining: number }> = [];
	const childCalls: Array<{ name: string; limits: unknown }> = [];

	const rows = (table: string): Map<string, Doc> => {
		let found = tables.get(table);
		if (!found) {
			found = new Map();
			tables.set(table, found);
		}
		return found;
	};

	const snapshot = () => ({
		tables: new Map([...tables].map(([name, docs]) => [name, new Map(docs)])),
		jobs: [...jobs]
	});
	const restore = (saved: ReturnType<typeof snapshot>) => {
		tables = saved.tables;
		jobs = saved.jobs;
	};

	const checkFault = (id: string) => {
		const fault = faults.find((candidate) => candidate.id === id && candidate.remaining > 0);
		if (fault) {
			fault.remaining--;
			throw new Error('planted write failure');
		}
	};

	/**
	 * One function execution: its own paginate allowance and, for a child run
	 * with `transactionLimits.bytesRead`, its own read meter.
	 */
	function makeCtx(extra: Record<string, unknown> = {}, bytesReadLimit?: number) {
		let paginated = false;
		let bytesRead = 0;
		// Charges what the backend counts against the limit: every document a read
		// returns, and again the document a patch or delete rewrites.
		const charge = (doc: Doc | undefined) => {
			if (doc === undefined || bytesReadLimit === undefined) return;
			bytesRead += getDocumentSize(doc as Record<string, Value>);
			if (bytesRead > bytesReadLimit) throw new Error('Transaction read too many bytes');
		};

		const rangeOf = (table: string, index: string, conditions: Condition[]) => {
			const fields = index === 'by_creation_time' ? [] : indexFields.get(`${table}.${index}`);
			if (!fields) throw new Error(`Unknown index ${table}.${index}`);
			const keyOf = (doc: Doc): Value[] =>
				[...fields, '_creationTime', '_id'].map((field) => doc[field] ?? null);
			const docs = [...rows(table).values()]
				.filter((doc) => conditions.every((condition) => matches(doc, condition)))
				.sort((a, b) => {
					for (const field of [...fields, '_creationTime', '_id']) {
						const order = compareValues(a[field], b[field]);
						if (order !== 0) return order;
					}
					return 0;
				});
			return { docs, keyOf, fields };
		};

		const query = (table: string) => {
			const withIndex = (index: string, build?: (q: unknown) => unknown) => {
				const conditions: Condition[] = [];
				const builder = {
					eq: (field: string, value: Value | undefined) => (
						conditions.push({ field, op: 'eq', value }),
						builder
					),
					gt: (field: string, value: Value) => (
						conditions.push({ field, op: 'gt', value }),
						builder
					),
					gte: (field: string, value: Value) => (
						conditions.push({ field, op: 'gte', value }),
						builder
					),
					lt: (field: string, value: Value) => (
						conditions.push({ field, op: 'lt', value }),
						builder
					),
					lte: (field: string, value: Value) => (
						conditions.push({ field, op: 'lte', value }),
						builder
					)
				};
				build?.(builder);
				let descending = false;
				const ordered = {
					order(direction: 'asc' | 'desc') {
						descending = direction === 'desc';
						return ordered;
					},
					async take(n: number) {
						const { docs } = rangeOf(table, index, conditions);
						const found = (descending ? docs.reverse() : docs).slice(0, n);
						found.forEach(charge);
						return found;
					},
					async collect() {
						return await ordered.take(Number.POSITIVE_INFINITY);
					},
					async first() {
						return (await ordered.take(1))[0] ?? null;
					},
					async unique() {
						const found = await ordered.take(2);
						if (found.length > 1) throw new Error('unique() found several documents');
						return found[0] ?? null;
					},
					async paginate(page: {
						cursor: string | null;
						numItems: number;
						maximumBytesRead?: number;
					}) {
						if (paginated) {
							throw new Error(
								'This query or mutation function ran multiple paginated queries. Convex only supports a single paginated query in each function.'
							);
						}
						paginated = true;
						if (descending) throw new Error('descending paginate is not modelled');
						const { docs, keyOf } = rangeOf(table, index, conditions);
						const after = page.cursor === null ? null : (JSON.parse(page.cursor) as Value[]);
						const remaining = after
							? docs.filter((doc) => compareValues(keyOf(doc), after) > 0)
							: docs;
						const result: Doc[] = [];
						let bytes = 0;
						// Like the backend, a page stops at `numItems` or its byte allowance
						// without looking ahead, so such a page is never done, even when it
						// took the last row.
						let isDone = false;
						while (result.length < page.numItems) {
							if (page.maximumBytesRead !== undefined && bytes >= page.maximumBytesRead) break;
							const doc = remaining[result.length];
							if (doc === undefined) {
								isDone = true;
								break;
							}
							charge(doc);
							result.push(doc);
							bytes += getDocumentSize(doc as Record<string, Value>);
						}
						const last = result[result.length - 1];
						return {
							page: result,
							isDone,
							continueCursor: last ? JSON.stringify(keyOf(last)) : (page.cursor ?? 'start')
						};
					}
				};
				return ordered;
			};
			return { ...withIndex('by_creation_time'), withIndex };
		};

		const db = {
			query,
			async get(table: string, id: string) {
				const doc = rows(table).get(id);
				charge(doc);
				return doc ?? null;
			},
			async insert(table: string, value: Record<string, Value | undefined>) {
				const id = `${table}:${nextId++}`;
				rows(table).set(id, { ...value, _id: id, _creationTime: Date.now() + nextId / 1000 });
				return id;
			},
			async patch(table: string, id: string, value: Record<string, Value | undefined>) {
				const doc = rows(table).get(id);
				if (!doc) throw new Error(`patch: ${id} does not exist`);
				charge(doc);
				checkFault(id);
				const next: Doc = { ...doc };
				for (const [field, fieldValue] of Object.entries(value)) {
					if (fieldValue === undefined) delete next[field];
					else next[field] = fieldValue;
				}
				rows(table).set(id, next);
			},
			async delete(table: string, id: string) {
				charge(rows(table).get(id));
				checkFault(id);
				rows(table).delete(id);
			}
		};

		const ctx = {
			db,
			scheduler: {
				async runAfter(delayMs: number, ref: unknown, args: Record<string, unknown>) {
					const name = getFunctionName(ref as never);
					jobs.push({ id: nextJob++, runAt: Date.now() + delayMs, name, args });
					return `job:${nextJob}`;
				}
			},
			async runQuery(ref: unknown, args: Record<string, unknown>) {
				let name: string;
				try {
					name = getFunctionName(ref as never);
				} catch {
					return userLookup(args);
				}
				return await call(name, args);
			},
			async runMutation(
				ref: unknown,
				args: Record<string, unknown>,
				options?: { transactionLimits?: { bytesRead?: number } }
			) {
				const name = getFunctionName(ref as never);
				childCalls.push({ name, limits: options?.transactionLimits });
				const saved = snapshot();
				try {
					return await call(name, args, options?.transactionLimits?.bytesRead);
				} catch (error) {
					restore(saved);
					throw error;
				}
			},
			...extra
		};
		return ctx;
	}

	/**
	 * The only component queries these paths make: Better Auth users by `_id`,
	 * one (`findOne`, `eq`) or several (`findMany`, `in`).
	 */
	function userLookup(args: Record<string, unknown>) {
		const where = (args.where as Array<{ field: string; operator: string; value: unknown }>)[0];
		if (args.model !== 'user' || where?.field !== '_id') {
			throw new Error('Unmodelled component query');
		}
		const profile = (id: string) => ({ _id: id, name: `Name of ${id}` });
		if (where.operator === 'in') {
			const ids = (where.value as string[]).filter((id) => users.has(id));
			return { page: ids.map(profile), isDone: true, continueCursor: '' };
		}
		const id = where.value as string;
		return users.has(id) ? profile(id) : null;
	}

	async function call(
		name: string,
		args: Record<string, unknown>,
		bytesReadLimit?: number
	): Promise<unknown> {
		const handler = functions.get(name);
		if (!handler) throw new Error(`Unregistered function ${name}`);
		return await (handler as (ctx: unknown, args: unknown) => Promise<unknown>)(
			makeCtx({}, bytesReadLimit),
			args
		);
	}

	let queue: Promise<unknown> = Promise.resolve();

	return {
		/**
		 * Run a registered function (or any handler) as one top-level
		 * transaction: serial, rolled back when it throws.
		 */
		mutate<Result>(
			fn: Registered | ((ctx: ReturnType<typeof makeCtx>) => Promise<Result>),
			args: object = {},
			extra: Record<string, unknown> = {}
		): Promise<Result> {
			const run = async () => {
				const saved = snapshot();
				try {
					const ctx = makeCtx(extra);
					// A registered Convex function is itself callable, so test for _handler.
					return (await ('_handler' in fn
						? (fn._handler as (ctx: unknown, args: unknown) => Promise<unknown>)(ctx, args)
						: fn(ctx))) as Result;
				} catch (error) {
					restore(saved);
					throw error;
				}
			};
			const result = queue.then(run, run);
			queue = result.catch(() => undefined);
			return result;
		},
		/**
		 * Context for an action: every `runMutation` is its own top-level
		 * transaction.
		 */
		actionCtx() {
			return {
				runMutation: (ref: unknown, args: Record<string, unknown>) => {
					const handler = functions.get(getFunctionName(ref as never));
					if (!handler) throw new Error('Unregistered function');
					return this.mutate({ _handler: handler }, args);
				}
			};
		},
		/**
		 * Run every scheduled job that is due, oldest first, until none is due.
		 * Throws after `limit` jobs, so work that reschedules itself forever
		 * fails the test instead of hanging it.
		 */
		async runDueJobs(limit = 200): Promise<string[]> {
			const ran: string[] = [];
			for (;;) {
				if (ran.length >= limit) throw new Error(`Still scheduling work after ${limit} jobs`);
				const due = jobs
					.filter((job) => job.runAt <= Date.now())
					.sort((a, b) => a.runAt - b.runAt)[0];
				if (!due) return ran;
				jobs = jobs.filter((job) => job.id !== due.id);
				ran.push(due.name);
				const handler = functions.get(due.name);
				if (!handler) throw new Error(`Unregistered scheduled function ${due.name}`);
				await this.mutate({ _handler: handler }, due.args);
			}
		},
		/** Pending jobs, with their delay from the current (fake) time. */
		jobs: () => jobs.map(({ runAt, name, args }) => ({ delayMs: runAt - Date.now(), name, args })),
		/** Child mutations this store ran, with the limits the caller requested. */
		childCalls: () => childCalls.map((call) => ({ ...call })),
		docs: (table: Table) => [...rows(table).values()],
		insert(table: Table, value: Record<string, Value | undefined>) {
			const id = `${table}:${nextId++}`;
			rows(table).set(id, { ...value, _id: id, _creationTime: Date.now() + nextId / 1000 });
			return id;
		},
		deleteUser(userId: string) {
			users.delete(userId);
		},
		failWrites(id: string, times = Number.POSITIVE_INFINITY) {
			faults.push({ id, remaining: times });
		},
		clearFaults() {
			faults.length = 0;
		}
	};
}
