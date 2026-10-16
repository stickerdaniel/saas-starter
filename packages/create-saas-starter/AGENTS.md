# create-saas-starter guidance

- A test that starts a real child process, directly with `runProcess` or through a `runCli` run that reaches Bun, starts it with `childWork` or `cliChildWork` from `test/child-work.ts` and awaits `settleChildWork()` in `afterEach` before restoring mocks or removing directories, because a Vitest timeout abandons the test body but not its children.
