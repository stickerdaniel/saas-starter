/**
 * Enforce Convex's one-paginated-query-per-function rule on a test's ctx.
 *
 * The backend rejects a second `.paginate()` in the same query or mutation with
 * `MultiplePaginatedDatabaseQueries`; convex-test 0.0.53 runs it without complaint, so a
 * function that pages twice passes every test and fails on the first real call. Wrap the
 * ctx a test hands to one function invocation, and a second page throws the same way.
 */
export function enforceSinglePagination<Ctx extends { db: object }>(ctx: Ctx): Ctx {
	let pages = 0;
	const wrap = (value: object): object =>
		new Proxy(value, {
			get(target, property, receiver) {
				const member: unknown = Reflect.get(target, property, receiver);
				if (typeof member !== 'function') return member;
				return (...args: unknown[]) => {
					if (property === 'paginate' && ++pages > 1) {
						throw new Error(
							'MultiplePaginatedDatabaseQueries: Convex runs one paginated query per function.'
						);
					}
					const result: unknown = member.apply(target, args);
					// Query builders chain; promises and plain values pass through untouched.
					return typeof result === 'object' && result !== null && !(result instanceof Promise)
						? wrap(result)
						: result;
				};
			}
		});
	return { ...ctx, db: wrap(ctx.db) as Ctx['db'] };
}
