# Documentation guidance

Repository docs contain only knowledge code cannot express:

1. rejected alternatives and decision rationale;
2. constraints imposed by platforms, providers, browsers, or law;
3. runbooks for systems outside the repository;
4. stable domain or editorial vocabulary;
5. thin maps that route readers to authoritative code, tests, decisions, and runbooks.

Plans belong in PR bodies. Audit findings belong in issues. Conventions belong in lint/static checks. Code facts and invariants belong in tests.

Do not preserve obsolete generated output, implementation snapshots, symbol catalogues, or current file lists “for reference.” If a document mixes durable rationale with current implementation, keep the rationale and replace the implementation narrative with links to authoritative entry points.

Decision records are dated and immutable. A later reversal adds a new decision with `supersedes` metadata and a link back; it never rewrites the original argument.

External setup guides may explain dashboard actions the repository cannot automate. Keep code-derived configuration in schemas/scripts and link to it rather than duplicating values or steps.
