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
 * - a page that reaches `numItems`, `maximumRowsRead` or `maximumBytesRead`
 *   (measured with `getDocumentSize`) returns `isDone: false` without looking
 *   ahead, even when it took the last row (`index_range.rs`);
 * - `runQuery` and `runMutation` children run with their own paginate
 *   allowance and record the arguments and `transactionLimits` the caller
 *   passed;
 * - a child's `transactionLimits` meter what it and its own children read
 *   (documents returned, plus the document a patch or delete rewrites) and
 *   write (inserted or patched documents, by `getDocumentSize`), and the
 *   operation that crosses a limit throws;
 * - a mutation that throws, including a caught `ctx.runMutation` child, leaves
 *   no writes and no scheduled functions behind;
 * - a scheduled function's `_scheduled_functions` row (`ctx.db.system.get`)
 *   moves from `pending` through `inProgress` to `success` or `failed`, and
 *   `ctx.scheduler.cancel` marks a `pending` or `inProgress` job `canceled`
 *   and leaves every other state, or a missing row, unchanged
 *   (convex-backend `crates/model/src/scheduled_jobs/mod.rs` `cancel`,
 *   read at a4ad3530c);
 * - mutations run one at a time, the serial outcome OCC guarantees.
 * Platform retries, the global limits and timing are out of scope (local
 * backend only).
 */

type Doc = Record<string, Value | undefined> & { _id: string; _creationTime: number };
type Table = keyof typeof schema.tables;
type Handler = (ctx: never, args: never) => Promise<unknown>;
type Registered = { _handler: Handler };
export type JobState = 'pending' | 'inProgress' | 'success' | 'failed' | 'canceled';
type Job = {
	id: string;
	runAt: number;
	name: string;
	args: Record<string, unknown>;
	state: JobState;
};
/** A Better Auth user as the adapter returns it. */
type UserProfile = {
	_id: string;
	name?: string;
	email?: string;
	locale?: string;
	createdAt?: number;
};
type Limits = {
	documentsRead?: number;
	bytesRead?: number;
	documentsWritten?: number;
	bytesWritten?: number;
};
/** Usage of one execution and its children against the limits its caller set. */
type Meter = { limits: Limits; parent?: Meter; used: Required<Limits> };
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

const LIMIT_ERRORS: Record<keyof Limits, string> = {
	documentsRead: 'Transaction read too many documents',
	bytesRead: 'Transaction read too many bytes',
	documentsWritten: 'Transaction wrote too many documents',
	bytesWritten: 'Transaction wrote too many bytes'
};

/** Charge one document to a meter and every meter above it; throws on the crossing operation. */
function charge(meter: Meter | undefined, kind: 'read' | 'write', bytes: number) {
	const [documents, size] =
		kind === 'read'
			? (['documentsRead', 'bytesRead'] as const)
			: (['documentsWritten', 'bytesWritten'] as const);
	for (let current = meter; current; current = current.parent) {
		current.used[documents] += 1;
		current.used[size] += bytes;
		for (const key of [documents, size]) {
			const limit = current.limits[key];
			if (limit !== undefined && current.used[key] > limit) throw new Error(LIMIT_ERRORS[key]);
		}
	}
}

export function createJourneyStore(
	options: {
		/** Better Auth users that exist: an id, or a profile with the fields lookups return. */
		users?: Array<string | UserProfile>;
		/** Registered functions reachable through `runMutation`, `runQuery` and the scheduler. */
		functions?: Record<string, Registered>;
	} = {}
) {
	let tables = new Map<string, Map<string, Doc>>();
	/** Every scheduled function, in any state; entries are replaced, never mutated. */
	let jobs: Job[] = [];
	let nextId = 1;
	let nextJob = 1;
	const users = new Map<string, UserProfile>(
		(options.users ?? []).map((user) =>
			typeof user === 'string' ? [user, { _id: user, name: `Name of ${user}` }] : [user._id, user]
		)
	);
	const functions = new Map(
		Object.entries(options.functions ?? {}).map(([name, fn]) => [name, fn._handler])
	);
	/** Throws inside a write to the matching document, `times` times. */
	const faults: Array<{ id: string; remaining: number }> = [];
	type Call = { name: string; args: Record<string, unknown>; limits: Limits | undefined };
	const childCalls: Call[] = [];
	const queryCalls: Call[] = [];

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
	const setState = (id: string, state: JobState) => {
		jobs = jobs.map((job) => (job.id === id ? { ...job, state } : job));
	};
	const schedule = (runAt: number, ref: unknown, args: Record<string, unknown>) => {
		const id = `job:${nextJob++}`;
		jobs.push({ id, runAt, name: getFunctionName(ref as never), args, state: 'pending' });
		return id;
	};

	const checkFault = (id: string) => {
		const fault = faults.find((candidate) => candidate.id === id && candidate.remaining > 0);
		if (fault) {
			fault.remaining--;
			throw new Error('planted write failure');
		}
	};

	/**
	 * One function execution: its own paginate allowance, charging its reads
	 * and writes to the meter of the nearest caller that set limits.
	 */
	function makeCtx(extra: Record<string, unknown> = {}, meter?: Meter) {
		let paginated = false;
		const read = (doc: Doc | undefined) => {
			if (doc !== undefined) charge(meter, 'read', getDocumentSize(doc as Record<string, Value>));
		};
		const write = (doc: Doc | null) =>
			charge(meter, 'write', doc ? getDocumentSize(doc as Record<string, Value>) : 0);

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
						found.forEach(read);
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
						maximumRowsRead?: number;
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
						// Like the backend, a page stops at `numItems`, `maximumRowsRead` or
						// its byte allowance without looking ahead, so such a page is never
						// done, even when it took the last row.
						let isDone = false;
						while (result.length < page.numItems) {
							if (result.length === page.maximumRowsRead) break;
							if (page.maximumBytesRead !== undefined && bytes >= page.maximumBytesRead) break;
							const doc = remaining[result.length];
							if (doc === undefined) {
								isDone = true;
								break;
							}
							read(doc);
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
				read(doc);
				return doc ?? null;
			},
			async insert(table: string, value: Record<string, Value | undefined>) {
				const id = `${table}:${nextId++}`;
				const doc: Doc = { ...value, _id: id, _creationTime: Date.now() + nextId / 1000 };
				write(doc);
				rows(table).set(id, doc);
				return id;
			},
			async patch(table: string, id: string, value: Record<string, Value | undefined>) {
				const doc = rows(table).get(id);
				if (!doc) throw new Error(`patch: ${id} does not exist`);
				read(doc);
				checkFault(id);
				const next: Doc = { ...doc };
				for (const [field, fieldValue] of Object.entries(value)) {
					if (fieldValue === undefined) delete next[field];
					else next[field] = fieldValue;
				}
				write(next);
				rows(table).set(id, next);
			},
			async delete(table: string, id: string) {
				read(rows(table).get(id));
				checkFault(id);
				write(null);
				rows(table).delete(id);
			},
			system: {
				async get(table: string, id: string) {
					if (table !== '_scheduled_functions') throw new Error(`Unmodelled system table ${table}`);
					const job = jobs.find((candidate) => candidate.id === id);
					if (!job) return null;
					const doc = {
						_id: job.id,
						_creationTime: job.runAt,
						name: job.name,
						args: [job.args],
						scheduledTime: job.runAt,
						state: { kind: job.state }
					};
					read(doc as unknown as Doc);
					return doc;
				}
			}
		};

		const ctx = {
			db,
			scheduler: {
				async runAfter(delayMs: number, ref: unknown, args: Record<string, unknown>) {
					return schedule(Date.now() + delayMs, ref, args);
				},
				async runAt(timestamp: number, ref: unknown, args: Record<string, unknown>) {
					return schedule(timestamp, ref, args);
				},
				async cancel(id: string) {
					const state = jobs.find((job) => job.id === id)?.state;
					if (state === 'pending' || state === 'inProgress') setState(id, 'canceled');
				}
			},
			async runQuery(
				ref: unknown,
				args: Record<string, unknown>,
				options?: { transactionLimits?: Limits }
			) {
				let name: string;
				try {
					name = getFunctionName(ref as never);
				} catch {
					return userLookup(args);
				}
				queryCalls.push({ name, args, limits: options?.transactionLimits });
				return await call(name, args, options?.transactionLimits, meter);
			},
			async runMutation(
				ref: unknown,
				args: Record<string, unknown>,
				options?: { transactionLimits?: Limits }
			) {
				const name = getFunctionName(ref as never);
				childCalls.push({ name, args, limits: options?.transactionLimits });
				const saved = snapshot();
				try {
					return await call(name, args, options?.transactionLimits, meter);
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
	 * one (`findOne`, `eq`) or several (`findMany`, `in`), and one user by
	 * `email` (`findOne`, `eq`).
	 */
	function userLookup(args: Record<string, unknown>) {
		const where = (args.where as Array<{ field: string; operator: string; value: unknown }>)[0];
		if (args.model !== 'user' || (where?.field !== '_id' && where?.field !== 'email')) {
			throw new Error('Unmodelled component query');
		}
		if (where.field === 'email') {
			if (where.operator !== 'eq') throw new Error('Unmodelled component query');
			return [...users.values()].find((user) => user.email === where.value) ?? null;
		}
		if (where.operator === 'in') {
			const page = (where.value as string[]).flatMap((id) => users.get(id) ?? []);
			return { page, isDone: true, continueCursor: '' };
		}
		return users.get(where.value as string) ?? null;
	}

	async function call(
		name: string,
		args: Record<string, unknown>,
		limits?: Limits,
		parent?: Meter
	): Promise<unknown> {
		const handler = functions.get(name);
		if (!handler) throw new Error(`Unregistered function ${name}`);
		const meter: Meter | undefined = limits
			? {
					limits,
					parent,
					used: { documentsRead: 0, bytesRead: 0, documentsWritten: 0, bytesWritten: 0 }
				}
			: parent;
		return await (handler as (ctx: unknown, args: unknown) => Promise<unknown>)(
			makeCtx({}, meter),
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
					.filter((job) => job.state === 'pending' && job.runAt <= Date.now())
					.sort((a, b) => a.runAt - b.runAt)[0];
				if (!due) return ran;
				ran.push(due.name);
				const handler = functions.get(due.name);
				if (!handler) throw new Error(`Unregistered scheduled function ${due.name}`);
				setState(due.id, 'inProgress');
				try {
					await this.mutate({ _handler: handler }, due.args);
				} catch (error) {
					setState(due.id, 'failed');
					throw error;
				}
				setState(due.id, 'success');
			}
		},
		/** Pending jobs, with their delay from the current (fake) time. */
		jobs: () =>
			jobs
				.filter((job) => job.state === 'pending')
				.map(({ runAt, name, args }) => ({ delayMs: runAt - Date.now(), name, args })),
		/** A scheduled function's id and state, in scheduling order. */
		scheduled: () => jobs.map(({ id, name, state }) => ({ id, name, state })),
		/** Move a scheduled function to `state`, or drop its system row (`null`). */
		setJobState(id: string, state: JobState | null) {
			if (state === null) jobs = jobs.filter((job) => job.id !== id);
			else setState(id, state);
		},
		/** Child mutations this store ran, with the limits the caller requested. */
		childCalls: () => childCalls.map(({ name, limits }) => ({ name, limits })),
		/** The arguments each child mutation named `name` received, in call order. */
		childArgs: (name: string) =>
			childCalls.filter((call) => call.name === name).map((call) => call.args),
		/** Registered queries this store ran through `runQuery`, with the limits requested. */
		queryCalls: () => queryCalls.map(({ name, limits }) => ({ name, limits })),
		// A component table is named `<component>:<table>`, as test doubles of component writes store them.
		docs: (table: Table | `${string}:${string}`) => [...rows(table).values()],
		/** Seed a document; `createdAt` pins its `_creationTime` exactly. */
		insert(table: Table, value: Record<string, Value | undefined>, createdAt?: number) {
			const id = `${table}:${nextId++}`;
			const _creationTime = createdAt ?? Date.now() + nextId / 1000;
			rows(table).set(id, { ...value, _id: id, _creationTime });
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
