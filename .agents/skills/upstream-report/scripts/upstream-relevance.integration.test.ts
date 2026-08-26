// Integration cover for the git-facing half of the detector.
//
// The pure helpers are unit-tested next door, but they were never the risk. The
// risk is the wiring around them: a base that silently becomes HEAD, a ref that
// belongs to another repository, a rename that loses its source, a first run
// that writes config into a shared checkout. Every one of those ends in a
// confident "nothing to report", which is the one answer that costs something
// real: a template fix that no other fork ever receives.
//
// So these run the actual script against throwaway repositories built here,
// with a local path as "upstream". Nothing touches the network or this
// repository. The convention follows scripts/git-context.staged-files.test.ts.

import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	utimesSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// POSIX executable wrappers, symlinks and control-byte filenames are gated.
// The detector and ordinary repository fixtures still run on native Windows.
const itWithGitWrapper = it.runIf(process.platform !== 'win32');
const itWithPosixPaths = it.runIf(process.platform !== 'win32');

const SCRIPT = resolve(
	process.cwd(),
	'.agents/skills/upstream-report/scripts/upstream-relevance.ts'
);
const TEST_FILE = resolve(
	process.cwd(),
	'.agents/skills/upstream-report/scripts/upstream-relevance.integration.test.ts'
);
const NULL_GIT_CONFIG = process.platform === 'win32' ? 'NUL' : '/dev/null';

const FIXTURE_GIT_VARS = [
	'GIT_DIR',
	'GIT_WORK_TREE',
	'GIT_INDEX_FILE',
	'GIT_OBJECT_DIRECTORY',
	'GIT_COMMON_DIR',
	'GIT_ALTERNATE_OBJECT_DIRECTORIES',
	'GIT_CEILING_DIRECTORIES',
	'GIT_CONFIG',
	'GIT_CONFIG_GLOBAL',
	'GIT_CONFIG_SYSTEM',
	'GIT_CONFIG_NOSYSTEM',
	'GIT_CONFIG_PARAMETERS',
	'GIT_NAMESPACE',
	'GIT_ALLOW_PROTOCOL',
	'GIT_PROTOCOL_FROM_USER',
	'GIT_SSH',
	'GIT_SSH_COMMAND',
	'GIT_SSH_VARIANT',
	'GIT_PROXY_COMMAND',
	'GIT_LITERAL_PATHSPECS',
	'GIT_NOGLOB_PATHSPECS',
	'GIT_GLOB_PATHSPECS',
	'GIT_ICASE_PATHSPECS'
];

function fixtureGitEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
	const env = { ...process.env };
	const scrubbed = new Set(FIXTURE_GIT_VARS.map((key) => key.toUpperCase()));
	for (const key of Object.keys(env)) {
		const normalized = key.toUpperCase();
		if (
			scrubbed.has(normalized) ||
			/^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/.test(normalized) ||
			normalized.startsWith('GIT_TRACE')
		) {
			delete env[key];
		}
	}
	env.GIT_GRAFT_FILE = join(tmpdir(), 'upstream-relevance-test-no-grafts');
	env.GIT_CONFIG_NOSYSTEM = '1';
	env.GIT_CONFIG_GLOBAL = NULL_GIT_CONFIG;
	env.GIT_CONFIG_SYSTEM = NULL_GIT_CONFIG;
	return { ...env, ...extra };
}

function git(cwd: string, args: string[], env?: Record<string, string>): string {
	const r = spawnSync('git', args, {
		cwd,
		encoding: 'utf-8',
		env: fixtureGitEnv(env)
	});
	if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
	return r.stdout.trim();
}

function gitOptional(cwd: string, args: string[]): string {
	return spawnSync('git', args, {
		cwd,
		encoding: 'utf-8',
		env: fixtureGitEnv()
	}).stdout.trim();
}

function gitInput(cwd: string, args: string[], input: string | Buffer): string {
	const r = spawnSync('git', args, { cwd, encoding: 'utf-8', input, env: fixtureGitEnv() });
	if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
	return r.stdout.trim();
}

function advertiseOriginMain(cwd: string, ref: string): void {
	const origin = git(cwd, ['remote', 'get-url', 'origin']);
	git(cwd, ['push', '-q', '--force', origin, `${ref}:refs/heads/main`]);
}

function markBase(cwd: string): void {
	advertiseOriginMain(cwd, 'HEAD');
	git(cwd, ['fetch', '-q']);
}

function realGitPath(): string {
	const r = spawnSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf-8' });
	if (r.status !== 0) throw new Error('git is not on PATH');
	return r.stdout.trim();
}

function copyObject(source: string, target: string, type: 'commit' | 'tree', sha: string): void {
	const read = spawnSync('git', ['cat-file', type, sha], { cwd: source, env: fixtureGitEnv() });
	if (read.status !== 0) throw new Error(`could not read ${type} ${sha}`);
	const write = spawnSync('git', ['hash-object', '-w', '-t', type, '--stdin'], {
		cwd: target,
		input: read.stdout,
		env: fixtureGitEnv()
	});
	if (write.status !== 0) throw new Error(`could not copy ${type} ${sha}`);
	expect(write.stdout.toString().trim()).toBe(sha);
}

function installGitWrapper(root: string): string {
	const dir = join(root, 'git-wrapper');
	mkdirSync(dir);
	const wrapper = join(dir, 'git');
	writeFileSync(
		wrapper,
		`#!/bin/sh
if [ "$FAKE_FETCH_SUCCESS" = "1" ]; then
  for arg in "$@"; do
    [ "$arg" = "fetch" ] && exit 0
  done
fi
command_line=" $* "
if [ -n "$FAKE_REMOTE_MAIN_SHA" ]; then
  case "$command_line" in
    *" ls-remote "*" refs/heads/main "*) printf '%s\trefs/heads/main\n' "$FAKE_REMOTE_MAIN_SHA"; exit 0 ;;
  esac
fi
if [ -n "$CHILD_ARG_SECRET" ]; then
  for arg in "$@"; do
    case "$arg" in
      *"$CHILD_ARG_SECRET"*) : > "$CHILD_ARG_MARKER" ;;
    esac
  done
fi
if [ -n "$FETCH_COMMAND_LOG" ]; then
  case "$command_line" in
    *" fetch "*) printf '%s\n' "$command_line" >> "$FETCH_COMMAND_LOG" ;;
  esac
fi
if [ -n "$TRANSPORT_CREDENTIAL_LOG" ]; then
  case "$command_line" in
    *" ls-remote "*) "$REAL_GIT" config --file "$GIT_DIR/config" --get-all credential.helper > "$TRANSPORT_CREDENTIAL_LOG" ;;
  esac
fi
if [ -n "$TRANSPORT_HTTP_LOG" ]; then
  case "$command_line" in
    *" ls-remote "*) "$REAL_GIT" config --file "$GIT_DIR/config" --get-regexp '^http\\..*\\.extraheader$' > "$TRANSPORT_HTTP_LOG" || : ;;
  esac
fi
if [ -n "$TRANSPORT_UNSCOPED_HTTP_LOG" ]; then
  case "$command_line" in
    *" ls-remote "*) "$REAL_GIT" config --file "$GIT_DIR/config" --get-all http.extraheader > "$TRANSPORT_UNSCOPED_HTTP_LOG" || : ;;
  esac
fi
if [ -n "$CAT_FILE_CHECK_LOG" ]; then
  case "$command_line" in
    *" cat-file --batch-check=%(objectname) %(objecttype) %(objectsize) "*) printf '%s\n' "$command_line" >> "$CAT_FILE_CHECK_LOG" ;;
  esac
fi
if [ -n "$FAKE_GIT_VERSION" ]; then
  case "$command_line" in
    *" version "*) printf 'git version %s\n' "$FAKE_GIT_VERSION"; exit 0 ;;
  esac
fi
if [ -n "$CASE_SCRUB_MARKER" ]; then
  if [ -n "\${git_dir+x}" ] || [ -n "\${git_work_tree+x}" ] || [ -n "\${git_ssh_command+x}" ] || [ -n "\${git_config_count+x}" ]; then
    : > "$CASE_SCRUB_MARKER"
    exit 97
  fi
fi
if [ -n "$TRANSPORT_REWRITE_REPO" ]; then
  case "$command_line" in
    *" config --null --get-regexp ^url\\..*\\.insteadof$ "*)
      "$REAL_GIT" "$@"
      rc=$?
      checks=0
      [ ! -e "$TRANSPORT_REWRITE_CHECKS" ] || read -r checks < "$TRANSPORT_REWRITE_CHECKS"
      checks=$((checks + 1))
      printf '%s\n' "$checks" > "$TRANSPORT_REWRITE_CHECKS"
      if [ "$checks" -eq 4 ]; then
        env -u GIT_INDEX_FILE -u GIT_DIR -u GIT_OBJECT_DIRECTORY -u GIT_SHALLOW_FILE -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM "$REAL_GIT" -C "$TRANSPORT_REWRITE_REPO" config "url.$TRANSPORT_REWRITE_TARGET.insteadOf" "$TRANSPORT_REWRITE_URL" || exit $?
        : > "$TRANSPORT_REWRITE_MARKER.added"
      fi
      exit $rc
      ;;
    *" ls-remote "*)
      "$REAL_GIT" "$@"
      rc=$?
      reads=0
      [ ! -e "$TRANSPORT_REWRITE_READS" ] || read -r reads < "$TRANSPORT_REWRITE_READS"
      reads=$((reads + 1))
      printf '%s\n' "$reads" > "$TRANSPORT_REWRITE_READS"
      if [ "$reads" -eq 2 ]; then
        env -u GIT_INDEX_FILE -u GIT_DIR -u GIT_OBJECT_DIRECTORY -u GIT_SHALLOW_FILE -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM "$REAL_GIT" -C "$TRANSPORT_REWRITE_REPO" config --unset-all "url.$TRANSPORT_REWRITE_TARGET.insteadOf" || exit $?
        : > "$TRANSPORT_REWRITE_MARKER"
      fi
      exit $rc
      ;;
  esac
fi
if [ -n "$PATH_ENUMERATION_LOG" ]; then
  case "$command_line" in
    *" ls-files -z --full-name --cached --others --exclude-standard -- "*|*" ls-tree -z --full-name --name-only -r "*)
      printf '%s\n' "$command_line" >> "$PATH_ENUMERATION_LOG"
      ;;
  esac
fi
if [ -n "$SCRATCH_INDEX_PATH_MARKER" ] && [ -n "$GIT_INDEX_FILE" ] && [ ! -e "$SCRATCH_INDEX_PATH_MARKER" ]; then
  printf '%s\n' "$GIT_INDEX_FILE" > "$SCRATCH_INDEX_PATH_MARKER"
fi
if [ -n "$RETARGET_TMPDIR_LINK" ] && [ ! -e "$RETARGET_TMPDIR_MARKER" ]; then
  case "$command_line" in
    *" rev-parse --path-format=absolute --git-dir "*)
      output=$("$REAL_GIT" "$@") || exit $?
      rm "$RETARGET_TMPDIR_LINK" || exit $?
      ln -s "$RETARGET_TMPDIR_TARGET" "$RETARGET_TMPDIR_LINK" || exit $?
      : > "$RETARGET_TMPDIR_MARKER"
      printf '%s\n' "$output"
      exit 0
      ;;
  esac
fi
if [ -n "$REMOVE_SCRATCH_INDEX_MARKER" ] && [ ! -e "$REMOVE_SCRATCH_INDEX_MARKER" ]; then
  case "$command_line" in
    *" ls-files -v -z "*)
      [ -n "$GIT_INDEX_FILE" ] || exit 1
      rm -f "$GIT_INDEX_FILE" || exit $?
      : > "$REMOVE_SCRATCH_INDEX_MARKER"
      ;;
  esac
fi
if [ -n "$STAGE_PRIVATE_INDEX_AFTER_COPY" ] && [ ! -e "$PRIVATE_INDEX_RACE_MARKER" ]; then
  case "$command_line" in
    *" config --null --get-all remote.upstream.url "*)
      output_file="$PRIVATE_INDEX_RACE_MARKER.output"
      "$REAL_GIT" "$@" > "$output_file" || exit $?
      [ -n "$GIT_INDEX_FILE" ] || exit 1
      "$REAL_GIT" update-index --add --cacheinfo "100644,$STAGE_PRIVATE_BLOB_SHA,$STAGE_PRIVATE_INDEX_AFTER_COPY" || exit $?
      : > "$PRIVATE_INDEX_RACE_MARKER"
      cat "$output_file"
      rm -f "$output_file"
      exit 0
      ;;
  esac
fi
if [ "$PARTIAL_INVALID_HISTORY" = "1" ]; then
  case "$command_line" in
    *" log --format= --raw -z "*) printf '\\303'; exit 1 ;;
  esac
fi
if [ "$SLOW_STATUS" = "1" ]; then
  case "$command_line" in
    *" status --porcelain=v2 "*) exec sleep 3600 ;;
  esac
fi
if [ "$SLOW_CHANGED_DIFF" = "1" ]; then
  case "$command_line" in
    *" diff --ignore-submodules=none --name-status -M "*) exec sleep 3600 ;;
  esac
fi
if [ "$SLOW_CAPTURED_DIFF" = "1" ]; then
  case "$command_line" in
    *" diff --no-index "*) exec sleep 3600 ;;
  esac
fi
if [ "$SLOW_HISTORY_LOG" = "1" ]; then
  case "$command_line" in
    *" log --format=%H --follow "*) sleep 2 ;;
  esac
fi
if [ "$SLOW_UPSTREAM_HISTORY_LOG" = "1" ]; then
  case "$command_line" in
    *" log --format= --raw "*) sleep 2 ;;
  esac
fi
if [ "$SLOW_UPSTREAM_OBJECT_CHECK" = "1" ]; then
  case "$command_line" in
    *" cat-file --batch-check=%(objectname) %(objecttype) ") exec sleep 3600 ;;
  esac
fi
if [ "$SLOW_ROOT_HISTORY" = "1" ]; then
  case "$command_line" in
    *" rev-list --max-parents=0 "*) sleep 2 ;;
  esac
fi
if [ "$SLOW_TREE_SCAN" = "1" ]; then
  case "$command_line" in
    *" ls-tree -r -z "*) exec sleep 3600 ;;
  esac
fi
if [ -n "$ADD_SHALLOW_AFTER_CHECK_SHA" ] && [ ! -e "$SHALLOW_RACE_MARKER" ]; then
  case "$command_line" in
    *" status --porcelain=v2 -z --untracked-files=all --ignore-submodules=none "*)
      "$REAL_GIT" "$@"
      rc=$?
      shallow="$CALLER_SHALLOW_PATH"
      [ -n "$shallow" ] || shallow=$("$REAL_GIT" rev-parse --git-path shallow) || exit $?
      printf '%s\n' "$ADD_SHALLOW_AFTER_CHECK_SHA" > "$shallow" || exit $?
      : > "$SHALLOW_RACE_MARKER"
      exit $rc
      ;;
  esac
fi
if [ -n "$ADD_SHALLOW_ABA_SHA" ]; then
  if [ ! -e "$SHALLOW_ABA_MARKER.added" ]; then
    case "$command_line" in
      *" status --porcelain=v2 -z --untracked-files=all --ignore-submodules=none "*)
        "$REAL_GIT" "$@"
        rc=$?
        printf '%s\n' "$ADD_SHALLOW_ABA_SHA" > "$CALLER_SHALLOW_PATH" || exit $?
        : > "$SHALLOW_ABA_MARKER.added"
        exit $rc
        ;;
    esac
  elif [ ! -e "$SHALLOW_ABA_MARKER" ]; then
    case "$command_line" in
      *" rev-list --max-parents=0 "*)
        output=$("$REAL_GIT" "$@") || exit $?
        rm -f "$CALLER_SHALLOW_PATH" || exit $?
        : > "$SHALLOW_ABA_MARKER"
        printf '%s\n' "$output"
        exit 0
        ;;
    esac
  fi
fi
if [ -n "$REJECT_REV_LIST_Z_MARKER" ]; then
  case "$command_line" in
    *" rev-list --objects -z "*)
      : > "$REJECT_REV_LIST_Z_MARKER"
      exit 129
      ;;
  esac
fi
if [ -n "$FAIL_CAPTURED_DIFF_MARKER" ] && [ ! -e "$FAIL_CAPTURED_DIFF_MARKER" ]; then
  case "$command_line" in
    *" diff --no-index "*)
      printf '%s\n' 'diff --git a/a b/b' '--- a/a' '+++ b/b' '@@ -1 +1 @@' '-old' '+new'
      : > "$FAIL_CAPTURED_DIFF_MARKER"
      exit 2
      ;;
  esac
fi
if [ -n "$UPSTREAM_AFTER_ORIGIN_SHA" ]; then
  case "$command_line" in
    *" ls-remote "*" refs/heads/main "*)
      if [ ! -e "$UPSTREAM_AFTER_ORIGIN_SEEN" ]; then
        : > "$UPSTREAM_AFTER_ORIGIN_SEEN"
      elif [ ! -e "$UPSTREAM_AFTER_ORIGIN_MARKER" ]; then
        output=$("$REAL_GIT" "$@") || exit $?
        env -u GIT_INDEX_FILE -u GIT_DIR -u GIT_OBJECT_DIRECTORY -u GIT_SHALLOW_FILE -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM "$REAL_GIT" -C "$UPSTREAM_AFTER_ORIGIN_REPO" update-ref refs/remotes/upstream/main "$UPSTREAM_AFTER_ORIGIN_SHA" || exit $?
        : > "$UPSTREAM_AFTER_ORIGIN_MARKER"
        printf '%s\n' "$output"
        exit 0
      fi
      ;;
  esac
fi
if [ -n "$FETCH_REF_SWAP_SHA" ] && [ ! -e "$FETCH_REF_SWAP_MARKER" ]; then
  case "$command_line" in
    *" fetch "*)
      "$REAL_GIT" "$@"
      rc=$?
      env -u GIT_INDEX_FILE -u GIT_DIR -u GIT_OBJECT_DIRECTORY -u GIT_SHALLOW_FILE -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM "$REAL_GIT" -C "$FETCH_REF_SWAP_REPO" update-ref refs/remotes/upstream/main "$FETCH_REF_SWAP_SHA" || exit $?
      : > "$FETCH_REF_SWAP_MARKER"
      exit $rc
      ;;
  esac
fi
if [ -n "$FETCH_URL_SWAP_REMOTE" ] && [ ! -e "$FETCH_URL_SWAP_MARKER" ]; then
  case "$command_line" in
    *" fetch "*)
      "$REAL_GIT" "$@"
      rc=$?
      env -u GIT_INDEX_FILE -u GIT_DIR -u GIT_OBJECT_DIRECTORY -u GIT_SHALLOW_FILE -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM "$REAL_GIT" -C "$FETCH_URL_SWAP_REPO" remote set-url upstream "$FETCH_URL_SWAP_REMOTE" || exit $?
      : > "$FETCH_URL_SWAP_MARKER"
      exit $rc
      ;;
  esac
fi
if [ -n "$ADD_REMOTE_SWAP_REMOTE" ] && [ ! -e "$ADD_REMOTE_SWAP_MARKER" ]; then
  case "$command_line" in
    *" remote add upstream "*)
      "$REAL_GIT" "$@"
      rc=$?
      "$REAL_GIT" remote set-url upstream "$ADD_REMOTE_SWAP_REMOTE" || exit $?
      : > "$ADD_REMOTE_SWAP_MARKER"
      exit $rc
      ;;
  esac
fi
if [ -n "$OVERLAP_ABA_PATH" ] && [ ! -e "$OVERLAP_ABA_MARKER" ]; then
  case "$command_line" in
    *" diff --ignore-submodules=none --unified=3 "*|*" diff --no-index --unified=3 "*)
      saved="$OVERLAP_ABA_MARKER.saved"
      cp "$OVERLAP_ABA_PATH" "$saved" || exit $?
      cp "$OVERLAP_ABA_REPLACEMENT" "$OVERLAP_ABA_PATH" || exit $?
      output_file="$OVERLAP_ABA_MARKER.output"
      "$REAL_GIT" "$@" > "$output_file"
      rc=$?
      cp "$saved" "$OVERLAP_ABA_PATH" || exit $?
      rm -f "$saved"
      : > "$OVERLAP_ABA_MARKER"
      cat "$output_file"
      rm -f "$output_file"
      exit $rc
      ;;
  esac
fi
if [ -n "$ORIGIN_RACE_SHA" ] && [ ! -e "$ORIGIN_RACE_MARKER" ]; then
  case "$command_line" in
    *" cat-file --batch "*)
      "$REAL_GIT" --git-dir="$ORIGIN_RACE_REMOTE" update-ref refs/heads/main "$ORIGIN_RACE_SHA" || exit $?
      env -u GIT_INDEX_FILE "$REAL_GIT" update-ref -m "fetch origin: forced-update" refs/remotes/origin/main "$ORIGIN_RACE_SHA" || exit $?
      : > "$ORIGIN_RACE_MARKER"
      ;;
  esac
fi
if [ "$SLOW_LS_REMOTE" = "1" ]; then
  case "$command_line" in
    *" ls-remote "*) sleep 2 ;;
  esac
fi
if [ -n "$STAGE_AFTER_INDEX_COPY" ] && [ ! -e "$INDEX_RACE_MARKER" ]; then
  case "$command_line" in
    *" config --null --get-all remote.upstream.url "*)
      output_file="$INDEX_RACE_MARKER.output"
      "$REAL_GIT" "$@" > "$output_file" || exit $?
      env -u GIT_INDEX_FILE "$REAL_GIT" update-index --add --cacheinfo "100644,$STAGE_BLOB_SHA,$STAGE_AFTER_INDEX_COPY" || exit $?
      : > "$INDEX_RACE_MARKER"
      cat "$output_file"
      rm -f "$output_file"
      exit 0
      ;;
  esac
fi
if [ -n "$REPLACE_AFTER_CONTENT_PATH" ] && [ ! -e "$CONTENT_RACE_MARKER" ]; then
  case "$command_line" in
    *" cat-file --batch "*)
      output_file="$CONTENT_RACE_MARKER.output"
      "$REAL_GIT" "$@" > "$output_file" || exit $?
      cp "$REPLACEMENT_CONTENT" "$REPLACE_AFTER_CONTENT_PATH" || exit $?
      : > "$CONTENT_RACE_MARKER"
      cat "$output_file"
      rm -f "$output_file"
      exit 0
      ;;
  esac
fi
if [ "$FETCH_AFTER_REFLOG" = "1" ] && [ ! -e "$FETCH_MARKER" ]; then
  case "$command_line" in
    *" reflog show "*" refs/remotes/upstream/main "*)
      output_file="$FETCH_MARKER.output"
      "$REAL_GIT" "$@" > "$output_file" || exit $?
      "$REAL_GIT" fetch -q upstream || exit $?
      : > "$FETCH_MARKER"
      cat "$output_file"
      rm -f "$output_file"
      exit 0
      ;;
  esac
fi
if [ -n "$FETCH_AFTER_TREE_SHA" ] && [ ! -e "$FETCH_MARKER" ]; then
  case "$command_line" in
    *" ls-tree -r -z $FETCH_AFTER_TREE_SHA "*)
      output_file="$FETCH_MARKER.output"
      "$REAL_GIT" "$@" > "$output_file" || exit $?
      "$REAL_GIT" fetch -q upstream || exit $?
      : > "$FETCH_MARKER"
      cat "$output_file"
      rm -f "$output_file"
      exit 0
      ;;
  esac
fi
if [ -n "$REMOVE_AFTER_UNTRACKED" ] && [ ! -e "$REMOVE_MARKER" ]; then
  case "$command_line" in
    *" ls-files --others "*)
      output_file="$REMOVE_MARKER.output"
      "$REAL_GIT" "$@" > "$output_file" || exit $?
      rm -f "$REMOVE_AFTER_UNTRACKED" || exit $?
      : > "$REMOVE_MARKER"
      cat "$output_file"
      rm -f "$output_file"
      exit 0
      ;;
  esac
fi
if [ -n "$ADD_AFTER_UNTRACKED" ] && [ ! -e "$LOCAL_CHANGE_MARKER" ]; then
  case "$command_line" in
    *" ls-files --others "*)
      output_file="$LOCAL_CHANGE_MARKER.output"
      "$REAL_GIT" "$@" > "$output_file" || exit $?
      printf 'lateFile();\n' > "$ADD_AFTER_UNTRACKED" || exit $?
      cp "$REPLACEMENT_MARKER" "$UPSTREAM_MARKER" || exit $?
      : > "$LOCAL_CHANGE_MARKER"
      cat "$output_file"
      rm -f "$output_file"
      exit 0
      ;;
  esac
fi
if [ -n "$SWAP_REMOTE" ] && [ ! -e "$SWAP_MARKER" ]; then
  case "$command_line" in
    *" config --null --get-all remote.upstream.url "*)
      output_file="$SWAP_MARKER.output"
      "$REAL_GIT" "$@" > "$output_file" || exit $?
      "$REAL_GIT" remote set-url upstream "$SWAP_REMOTE" || exit $?
      "$REAL_GIT" fetch -q upstream || exit $?
      : > "$SWAP_MARKER"
      cat "$output_file"
      rm -f "$output_file"
      exit 0
      ;;
  esac
fi
if [ -n "$ABA_DECOY_REMOTE" ] && [ ! -e "$ABA_REMOTE_MARKER" ]; then
  case "$command_line" in
    *" fetch "*)
      env -u GIT_DIR -u GIT_OBJECT_DIRECTORY -u GIT_SHALLOW_FILE -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM "$REAL_GIT" -C "$ABA_REPO" remote set-url upstream "$ABA_DECOY_REMOTE" || exit $?
      "$REAL_GIT" "$@"
      rc=$?
      env -u GIT_DIR -u GIT_OBJECT_DIRECTORY -u GIT_SHALLOW_FILE -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM "$REAL_GIT" -C "$ABA_REPO" remote set-url upstream "$ABA_EXPECTED_REMOTE" || exit $?
      : > "$ABA_REMOTE_MARKER"
      exit $rc
      ;;
  esac
fi
if [ -n "$ABA_WORKTREE_PATH" ] && [ ! -e "$ABA_WORKTREE_MARKER" ]; then
  case "$command_line" in
    *" diff --ignore-submodules=none --name-status -M -z $ABA_HEAD "*)
      saved="$ABA_WORKTREE_MARKER.saved"
      cp "$ABA_WORKTREE_PATH" "$saved" || exit $?
      cp "$ABA_HEAD_CONTENT" "$ABA_WORKTREE_PATH" || exit $?
      output_file="$ABA_WORKTREE_MARKER.output"
      "$REAL_GIT" "$@" > "$output_file"
      rc=$?
      cp "$saved" "$ABA_WORKTREE_PATH" || exit $?
      rm -f "$saved"
      : > "$ABA_WORKTREE_MARKER"
      cat "$output_file"
      rm -f "$output_file"
      exit $rc
      ;;
  esac
fi
if [ -n "$ABA_CAPTURE_PATH" ]; then
  if [ ! -e "$ABA_CAPTURE_MARKER.swapped" ]; then
    case "$command_line" in
      *" cat-file --batch "*)
        output_file="$ABA_CAPTURE_MARKER.output"
        "$REAL_GIT" "$@" > "$output_file"
        rc=$?
        cp "$ABA_CAPTURE_REPLACEMENT" "$ABA_CAPTURE_PATH" || exit $?
        : > "$ABA_CAPTURE_MARKER.swapped"
        cat "$output_file"
        rm -f "$output_file"
        exit $rc
        ;;
    esac
  elif [ ! -e "$ABA_CAPTURE_MARKER" ]; then
    case "$command_line" in
      *" status --porcelain=v2 -z --untracked-files=all --ignore-submodules=none "*)
        cp "$ABA_CAPTURE_ORIGINAL" "$ABA_CAPTURE_PATH" || exit $?
        : > "$ABA_CAPTURE_MARKER"
        ;;
    esac
  fi
fi
if [ -n "$INDEX_ABA_PATH" ]; then
  if [ ! -e "$INDEX_ABA_MARKER.swapped" ]; then
    case "$command_line" in
      *" rev-parse --show-object-format "*)
        output=$("$REAL_GIT" "$@") || exit $?
        cp "$INDEX_ABA_ORDINARY" "$INDEX_ABA_PATH" || exit $?
        : > "$INDEX_ABA_MARKER.swapped"
        printf '%s\n' "$output"
        exit 0
        ;;
    esac
  elif [ ! -e "$INDEX_ABA_MARKER" ]; then
    case "$command_line" in
      *" status --porcelain=v2 -z --untracked-files=all --ignore-submodules=none "*)
        cp "$INDEX_ABA_SPLIT" "$INDEX_ABA_PATH" || exit $?
        : > "$INDEX_ABA_MARKER"
        ;;
    esac
  fi
fi
exec "$REAL_GIT" "$@"
`
	);
	chmodSync(wrapper, 0o755);
	return dir;
}

/** Index copies left by one detector process, identified by its owner file. */
function leakedIndexCopies(owner: number): string[] {
	return readdirSync(tmpdir())
		.filter((name) => name.startsWith('upstream-relevance-index-'))
		.filter((name) => {
			try {
				return Number(readFileSync(join(tmpdir(), name, 'owner'), 'utf8')) === owner;
			} catch {
				return false;
			}
		})
		.sort();
}

function run(
	cwd: string,
	args: string[],
	env?: Record<string, string>
): { pid: number; status: number; stdout: string; stderr: string } {
	const r = spawnSync('bun', [SCRIPT, ...args], {
		cwd,
		encoding: 'utf-8',
		env: fixtureGitEnv(env),
		timeout: 30_000,
		killSignal: 'SIGKILL'
	});
	return { pid: r.pid, status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function verdicts(cwd: string, args: string[] = []): Record<string, string> {
	const effective = args.includes('--fetch') ? args : ['--fetch', ...args];
	const r = run(cwd, ['--json', ...effective]);
	expect(r.status, `script failed: ${r.stderr}`).toBe(0);
	const parsed = JSON.parse(r.stdout) as { verdicts: Array<{ path: string; relevance: string }> };
	return Object.fromEntries(parsed.verdicts.map((v) => [v.path, v.relevance]));
}

function verdictsWithScore(
	cwd: string,
	args: string[] = []
): Record<string, { relevance: string; overlap?: number }> {
	const effective = args.includes('--fetch') ? args : ['--fetch', ...args];
	const r = run(cwd, ['--json', ...effective]);
	expect(r.status, `script failed: ${r.stderr}`).toBe(0);
	const parsed = JSON.parse(r.stdout) as {
		verdicts: Array<{ path: string; relevance: string; overlap?: number }>;
	};
	return Object.fromEntries(parsed.verdicts.map((v) => [v.path, v]));
}

function write(root: string, rel: string, content: string): void {
	const full = join(root, rel);
	mkdirSync(join(full, '..'), { recursive: true });
	writeFileSync(full, content);
}

function init(root: string, objectFormat: 'sha1' | 'sha256' = 'sha1'): void {
	git(root, ['init', '-q', '-b', 'main', `--object-format=${objectFormat}`]);
	git(root, ['config', 'user.email', 'test@example.com']);
	git(root, ['config', 'user.name', 'Test']);
	git(root, ['config', 'commit.gpgsign', 'false']);
}

describe('upstream-relevance (integration)', () => {
	let tmp: string;
	let upstream: string;
	let fork: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'upstream-relevance-'));

		// A miniature template.
		upstream = join(tmp, 'template');
		mkdirSync(upstream);
		init(upstream);
		write(upstream, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 2;\n');
		write(
			upstream,
			'shared/rewritten.ts',
			'export const template1 = 1;\nexport const template2 = 2;\nexport const template3 = 3;\nexport const template4 = 4;\nexport const template5 = 5;\nexport const template6 = 6;\nexport const template7 = 7;\nexport const template8 = 8;\n'
		);
		// A NUL byte is what makes git call it binary and emit no hunks at all.
		write(upstream, 'shared/binary.bin', 'template\u0000payload');
		write(upstream, 'shared/encöded.ts', 'export const t = 1;\nexport const u = 2;\n');
		// Only the template has this spelling; the fork carries the lowercase one,
		// which the case-fold test relies on. The two cannot coexist in one
		// working tree on a case-insensitive filesystem, so they live one per repo.
		write(upstream, 'shared/Config.ts', 'export const config = 1;\n');
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'template']);
		const upstreamBase = git(upstream, ['rev-parse', 'HEAD']);

		// A fork of it: same paths, plus its own, with one file already rewritten.
		fork = join(tmp, 'fork');
		mkdirSync(fork);
		init(fork);
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 2;\n');
		// Template section on top, a block this fork appended underneath. Editing
		// deep inside the fork block must not read as an edit to template code.
		write(
			fork,
			'shared/rewritten.ts',
			'export const template1 = 1;\nexport const template2 = 2;\nexport const template3 = 3;\nexport const template4 = 4;\nexport const template5 = 5;\nexport const template6 = 6;\nexport const template7 = 7;\nexport const template8 = 8;\nexport const forkOnly1 = 1;\nexport const forkOnly2 = 2;\nexport const forkOnly3 = 3;\nexport const forkOnly4 = 4;\nexport const forkOnly5 = 5;\nexport const forkOnly6 = 6;\nexport const forkOnly7 = 7;\nexport const forkOnly8 = 8;\n'
		);
		// Already diverged from the template at the base, so editing it exercises
		// the binary path instead of the pristine one.
		write(fork, 'shared/binary.bin', 'fork\u0000payload');
		write(fork, 'shared/encöded.ts', 'export const t = 1;\nexport const u = 2;\n');
		write(fork, 'product/only-here.ts', 'export const product = true;\n');
		write(
			fork,
			'.upstream-sync.json',
			JSON.stringify({ upstreamUrl: upstream, forkPoint: upstreamBase, lastSynced: upstreamBase })
		);
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'fork base']);
		// `origin` is the fork's own remote and must differ from the template, or
		// the script correctly refuses to run at all.
		const origin = join(tmp, 'fork-origin.git');
		mkdirSync(origin);
		git(origin, ['init', '--bare', '-q']);
		git(fork, ['remote', 'add', 'origin', origin]);
		git(fork, ['remote', 'add', 'upstream', upstream]);
		git(fork, ['fetch', '-q', 'upstream']);
		// `origin/main` must exist for the default base; point it at the fork's
		// own base commit the way a real remote trunk would be.
		markBase(fork);
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('isolates fixture Git commands from user and system config', () => {
		const env = fixtureGitEnv();
		expect(env.GIT_CONFIG_NOSYSTEM).toBe('1');
		expect(env.GIT_CONFIG_GLOBAL).toBe(NULL_GIT_CONFIG);
		expect(env.GIT_CONFIG_SYSTEM).toBe(NULL_GIT_CONFIG);
	});

	it('keeps fixture Git commands inside their temporary repository', () => {
		const safe = join(tmp, 'safe-fixture');
		mkdirSync(safe);
		const oldDir = process.env.GIT_DIR;
		const oldTree = process.env.GIT_WORK_TREE;
		process.env.GIT_DIR = join(upstream, '.git');
		process.env.GIT_WORK_TREE = upstream;
		try {
			init(safe);
			write(safe, 'safe.ts', 'export const safe = true;\n');
			git(safe, ['add', '-A']);
			git(safe, ['commit', '-qm', 'safe fixture']);
		} finally {
			if (oldDir === undefined) delete process.env.GIT_DIR;
			else process.env.GIT_DIR = oldDir;
			if (oldTree === undefined) delete process.env.GIT_WORK_TREE;
			else process.env.GIT_WORK_TREE = oldTree;
		}

		expect(existsSync(join(safe, '.git'))).toBe(true);
		expect(git(safe, ['show', 'HEAD:safe.ts'])).toContain('safe = true');
	});

	it('scrubs command-scope config from fixture Git calls', () => {
		const keys = ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_TRACE2_EVENT'];
		const previous = new Map(keys.map((key) => [key, process.env[key]]));
		process.env.GIT_CONFIG_COUNT = '1';
		process.env.GIT_CONFIG_KEY_0 = 'commit.gpgsign';
		process.env.GIT_CONFIG_VALUE_0 = 'true';
		process.env.GIT_TRACE2_EVENT = join(tmp, 'fixture-trace.json');
		try {
			const env = fixtureGitEnv();
			for (const key of keys) expect(env[key]).toBeUndefined();
		} finally {
			for (const [key, value] of previous) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	});

	it('scrubs a namespace that redirects local remote advertisements', () => {
		const decoyUpstream = git(upstream, ['rev-parse', 'HEAD']);
		write(upstream, 'shared/namespaced.ts', 'export const namespaceSafe = 1;\n');
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add ordinary upstream namespace path']);
		git(upstream, ['update-ref', 'refs/namespaces/decoy/refs/heads/main', decoyUpstream]);
		git(fork, ['fetch', '-q', 'upstream']);
		write(fork, 'shared/namespaced.ts', 'export const namespaceSafe = 1;\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'copy namespace path']);
		markBase(fork);
		write(fork, 'shared/namespaced.ts', 'export const namespaceSafe = 2;\n');
		git(fork, ['commit', '-qam', 'edit namespace path']);

		const origin = git(fork, ['remote', 'get-url', 'origin']);
		git(origin, [
			'update-ref',
			'refs/namespaces/decoy/refs/heads/main',
			git(fork, ['rev-parse', 'refs/remotes/origin/main'])
		]);
		const r = run(fork, ['--fetch', '--json', 'shared/namespaced.ts'], {
			GIT_NAMESPACE: 'decoy'
		});
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string }>;
		};
		expect(parsed.verdicts[0]?.relevance).toBe('pristine');
	});

	itWithGitWrapper('scrubs Git environment names case-insensitively', () => {
		const marker = join(tmp, 'case-insensitive-env-leak');
		const r = run(fork, ['--fetch', '--json', 'shared/pristine.ts'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			CASE_SCRUB_MARKER: marker,
			git_dir: join(tmp, 'wrong-git-dir'),
			git_work_tree: join(tmp, 'wrong-worktree'),
			git_ssh_command: join(tmp, 'wrong-ssh'),
			git_config_count: '1',
			git_config_key_0: 'core.fileMode',
			git_config_value_0: 'false'
		});
		expect(r.status, r.stderr).toBe(0);
		expect(existsSync(marker)).toBe(false);
	});

	itWithPosixPaths('scrubs inherited protocol permission before reading the marker URL', () => {
		const executed = join(tmp, 'ext-protocol-executed');
		const helper = join(tmp, 'ext-protocol-helper');
		writeFileSync(helper, `#!/bin/sh\n: > "${executed}"\nexit 1\n`);
		chmodSync(helper, 0o755);
		const marker = JSON.parse(readFileSync(join(fork, '.upstream-sync.json'), 'utf8')) as {
			forkPoint: string;
			lastSynced: string;
		};
		const url = `ext::${helper}`;
		write(fork, '.upstream-sync.json', JSON.stringify({ ...marker, upstreamUrl: url }));
		git(fork, ['commit', '-qam', 'set ext parent']);
		git(fork, ['remote', 'set-url', 'upstream', url]);

		const r = run(fork, ['--fetch', '--json'], {
			GIT_ALLOW_PROTOCOL: 'ext:file',
			GIT_PROTOCOL_FROM_USER: '1'
		});

		expect(r.status).not.toBe(0);
		expect(existsSync(executed)).toBe(false);
	});

	it('refuses a relative temporary directory before writing or sweeping', () => {
		const victim = join(fork, 'upstream-relevance-index-victim');
		mkdirSync(victim);
		writeFileSync(join(victim, 'keep'), 'unrelated');
		const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
		utimesSync(victim, old, old);

		const r = run(fork, ['--json'], { TMPDIR: '.' });

		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/temporary directory must be an absolute path/);
		expect(existsSync(victim)).toBe(true);
		expect(
			readdirSync(fork).filter((name) => name.startsWith('upstream-relevance-index-'))
		).toEqual(['upstream-relevance-index-victim']);
	});

	it('refuses an absolute temporary directory inside the repository', () => {
		const inside = join(fork, 'detector-temp');
		mkdirSync(inside);

		const r = run(fork, ['--json'], { TMPDIR: inside });

		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/temporary directory resolves inside this repository/);
		expect(readdirSync(inside)).toEqual([]);
	});

	it('refuses shared repository storage as a linked-worktree temp directory', () => {
		const linked = join(tmp, 'linked-worktree');
		git(fork, ['worktree', 'add', '-q', '-b', 'linked-test', linked, 'HEAD']);

		const r = run(linked, ['--json'], { TMPDIR: join(fork, '.git') });

		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/shared Git storage/);
	});

	it('refuses a temporary directory inside a sibling linked worktree', () => {
		const sibling = join(tmp, 'sibling-worktree');
		git(fork, ['worktree', 'add', '-q', '-b', 'sibling-test', sibling, 'HEAD']);
		const insideSibling = join(sibling, 'detector-temp');
		mkdirSync(insideSibling);

		const r = run(fork, ['--json'], { TMPDIR: insideSibling });

		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/temporary directory resolves inside this repository/);
		expect(readdirSync(insideSibling)).toEqual([]);
	});

	it('refuses an unknown primary checkout from a separate Git directory', () => {
		const primary = join(tmp, 'separate-primary');
		const storage = join(tmp, 'separate-storage');
		const linked = join(tmp, 'separate-linked');
		git(tmp, ['clone', '-q', `--separate-git-dir=${storage}`, fork, primary]);
		git(primary, ['worktree', 'add', '-q', '-b', 'separate-linked', linked, 'HEAD']);
		const insidePrimary = join(primary, 'detector-temp');
		mkdirSync(insidePrimary);

		const r = run(linked, ['--json'], { TMPDIR: insidePrimary });

		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/cannot identify the primary checkout/);
		expect(readdirSync(insidePrimary)).toEqual([]);
	});

	itWithPosixPaths('uses the validated temp root after its symlink is retargeted', () => {
		const safeTemp = join(tmp, 'safe-temp');
		const repositoryTemp = join(fork, 'retargeted-temp');
		const tempLink = join(tmp, 'temp-link');
		const retargeted = join(tmp, 'temp-retargeted');
		const scratchPath = join(tmp, 'scratch-index-path');
		mkdirSync(safeTemp);
		mkdirSync(repositoryTemp);
		symlinkSync(safeTemp, tempLink);

		const r = run(fork, ['--json'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			TMPDIR: tempLink,
			RETARGET_TMPDIR_LINK: tempLink,
			RETARGET_TMPDIR_TARGET: repositoryTemp,
			RETARGET_TMPDIR_MARKER: retargeted,
			SCRATCH_INDEX_PATH_MARKER: scratchPath
		});

		expect(r.status, r.stderr).toBe(0);
		expect(existsSync(retargeted)).toBe(true);
		expect(readFileSync(scratchPath, 'utf8').startsWith(`${realpathSync(safeTemp)}/`)).toBe(true);
		expect(readdirSync(repositoryTemp)).toEqual([]);
	});

	it('refuses a missing Git index', () => {
		rmSync(join(fork, '.git', 'index'));

		const r = run(fork, ['--json']);

		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/requires an existing Git index/);
	});

	it('keeps core.splitIndex from activating on the scratch index', () => {
		git(fork, ['config', 'core.splitIndex', 'true']);
		const changedStat = new Date(Date.now() + 2_000);
		utimesSync(join(fork, 'shared/pristine.ts'), changedStat, changedStat);
		const before = readdirSync(join(fork, '.git')).filter((name) =>
			name.startsWith('sharedindex.')
		);

		const r = run(fork, ['--fetch', '--json']);

		expect(r.status, r.stderr).toBe(0);
		expect(
			readdirSync(join(fork, '.git')).filter((name) => name.startsWith('sharedindex.'))
		).toEqual(before);
	});

	it('classifies an edit to untouched template code as pristine', () => {
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 99;\n');
		git(fork, ['commit', '-qam', 'fix']);
		expect(verdicts(fork)['shared/pristine.ts']).toBe('pristine');
	});

	it('reports a template file copied to a new path and customised here', () => {
		// The silent negative that three earlier rounds left standing. Blob
		// identity only recognises a copy nobody edited, and the name rung only a
		// relocation that kept its name; a template file copied to a
		// product-specific path and customised in the same commit matches neither
		// and was hidden entirely. Measured on this repository, an email template
		// was a 59% copy of the template's own and classified fork-only, so an
		// accessibility fix made in it would never have been offered upstream.
		write(
			fork,
			'product/derived.ts',
			'export const template1 = 1;\nexport const template2 = 2;\nexport const template3 = 3;\nexport const template4 = 4;\nexport const template5 = 5;\nexport const template6 = 6;\nexport const template7 = 7;\nexport const template8 = 8;\nexport const forkExtra1 = 1;\nexport const forkExtra2 = 2;\n'
		);
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'copy and customise']);

		const v = verdicts(fork);
		expect(v['product/derived.ts']).toBe('unmeasured');
		const r = run(fork, []);
		expect(r.stdout).toContain('shared/rewritten.ts');
	});

	it('keeps a wholly new file visible for design judgment', () => {
		// The rung has to stay a measurement. A threshold low enough to flag every
		// file sharing a shape would restore by noise exactly what the score
		// avoids by design: a report nobody reads.
		write(
			fork,
			'product/unrelated.ts',
			'export function unrelated(): void {\n\tqueueDaphneJob();\n}\n'
		);
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add unrelated']);

		expect(verdicts(fork)['product/unrelated.ts']).toBe('unmeasured');
	});

	it('keeps base ancestry after the working tree rewrites the copy', () => {
		const shared = Array.from({ length: 10 }, (_, i) => `export const ancestor${i} = ${i};`);
		write(upstream, 'shared/ancestry-source.ts', `${shared.join('\n')}\n`);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add ancestry source']);
		git(fork, ['fetch', '-q', 'upstream']);

		write(
			fork,
			'product/derived-after-edit.ts',
			`${[...shared.slice(0, 6), 'forkOne();', 'forkTwo();', 'forkThree();', 'forkFour();'].join('\n')}\n`
		);
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add customised copy']);
		markBase(fork);

		write(fork, 'product/derived-after-edit.ts', 'completelyDifferent();\nfromTheCurrentEdit();\n');
		git(fork, ['commit', '-qam', 'rewrite after base']);
		expect(verdicts(fork)['product/derived-after-edit.ts']).toBe('unmeasured');
	});

	it('keeps exact upstream ancestry from an intermediate feature commit', () => {
		const source = Array.from({ length: 6 }, (_, i) => `export const inherited${i} = ${i};`);
		write(upstream, 'shared/intermediate-source.ts', `${source.join('\n')}\n`);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add intermediate source']);
		git(fork, ['fetch', '-q', 'upstream']);

		write(fork, 'product/intermediate-copy.ts', 'originalForkOnly();\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add fork-owned base']);
		markBase(fork);
		write(fork, 'product/intermediate-copy.ts', `${source.join('\n')}\n`);
		git(fork, ['commit', '-qam', 'copy exact source']);
		write(fork, 'product/intermediate-copy.ts', 'completelyDifferent();\nfinalRewrite();\n');
		git(fork, ['commit', '-qam', 'rewrite copied source']);

		for (const env of [undefined, { GIT_LITERAL_PATHSPECS: '1' }]) {
			const r = run(fork, ['--fetch', '--json'], env);
			expect(r.status, `script failed: ${r.stderr}`).toBe(0);
			const parsed = JSON.parse(r.stdout) as {
				verdicts: Array<{ path: string; relevance: string }>;
			};
			expect(
				parsed.verdicts.find((v) => v.path === 'product/intermediate-copy.ts')?.relevance
			).toBe('unmeasured');
		}
	});

	it('keeps exact upstream ancestry from before the selected base', () => {
		const source = Array.from({ length: 6 }, (_, i) => `export const oldInherited${i} = ${i};`);
		write(upstream, 'shared/old-source.ts', `${source.join('\n')}\n`);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add old source']);
		git(fork, ['fetch', '-q', 'upstream']);

		write(fork, 'product/historical-copy.ts', `${source.join('\n')}\n`);
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'copy exact source']);
		write(fork, 'product/historical-copy.ts', 'forkRewriteOne();\nforkRewriteTwo();\n');
		git(fork, ['commit', '-qam', 'rewrite before base']);
		markBase(fork);
		write(fork, 'product/historical-copy.ts', 'forkRewriteOne();\nfeatureEdit();\n');
		git(fork, ['commit', '-qam', 'edit rewritten copy']);

		expect(verdicts(fork)['product/historical-copy.ts']).toBe('unmeasured');
	});

	it('follows exact ancestry across a historical rename', () => {
		const source = Array.from({ length: 8 }, (_, i) => `export const renamedInherited${i} = ${i};`);
		write(upstream, 'shared/rename-source.ts', `${source.join('\n')}\n`);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add rename source']);
		git(fork, ['fetch', '-q', 'upstream']);

		write(fork, 'product/legacy-copy.ts', `${source.join('\n')}\n`);
		write(
			fork,
			'product/decoy-before.ts',
			`${source.map((_, i) => `decoyBefore${i}();`).join('\n')}\n`
		);
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'copy exact rename source']);
		git(fork, ['config', 'diff.renameLimit', '1']);
		git(fork, ['mv', 'product/legacy-copy.ts', 'product/renamed-copy.ts']);
		git(fork, ['mv', 'product/decoy-before.ts', 'product/decoy-after.ts']);
		write(
			fork,
			'product/renamed-copy.ts',
			`${[...source.slice(0, 3), 'forkFour();', 'forkFive();', 'forkSix();', 'forkSeven();', 'forkEight();'].join('\n')}\n`
		);
		write(
			fork,
			'product/decoy-after.ts',
			`${['decoyBefore0();', 'decoyBefore1();', 'decoyAfter2();', 'decoyAfter3();'].join('\n')}\n`
		);
		git(fork, ['commit', '-qam', 'rename and customize copy']);
		markBase(fork);
		write(
			fork,
			'product/renamed-copy.ts',
			`${[...source.slice(0, 2), 'featureEdit();', 'forkFour();', 'forkFive();', 'forkSix();', 'forkSeven();', 'forkEight();'].join('\n')}\n`
		);
		git(fork, ['commit', '-qam', 'edit renamed copy']);

		const r = run(fork, ['--fetch', '--json', '--all']);
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'product/renamed-copy.ts');
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/content is upstream elsewhere/);
	});

	it('follows ancestry through a merge-created rename', () => {
		const source = Array.from({ length: 12 }, (_, i) => `mergeInheritedToken${i}();`);
		write(upstream, 'shared/merge-source.ts', `${source.join('\n')}\n`);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add merge source']);
		git(fork, ['fetch', '-q', 'upstream']);
		write(fork, 'product/merge-source.ts', `${source.join('\n')}\n`);
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'copy merge source']);
		git(fork, ['checkout', '-q', '-b', 'merge-side']);
		write(fork, 'product/side-unrelated.ts', 'sideUnrelated();\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'diverge merge side']);
		git(fork, ['checkout', '-q', 'main']);
		write(fork, 'product/merge-unrelated.ts', 'mergeUnrelated();\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'diverge before merge']);
		git(fork, ['merge', '--no-ff', '--no-commit', '-q', 'merge-side']);
		git(fork, ['mv', 'product/merge-source.ts', 'product/renamed-product.ts']);
		write(
			fork,
			'product/renamed-product.ts',
			`${[...source.slice(0, 2), ...Array.from({ length: 10 }, (_, i) => `mergeForkRewrite${i}();`)].join('\n')}\n`
		);
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'rename while merging']);
		markBase(fork);
		write(
			fork,
			'product/renamed-product.ts',
			`${[source[0]!, 'mergeFeatureEdit();', ...Array.from({ length: 10 }, (_, i) => `mergeForkRewrite${i}();`)].join('\n')}\n`
		);
		git(fork, ['commit', '-qam', 'edit merge-created destination']);

		const r = run(fork, ['--fetch', '--json', '--all']);
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'product/renamed-product.ts');
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/content is upstream elsewhere/);
	});

	it('keeps a blobless inexact rename unmeasured', () => {
		const source = Array.from({ length: 12 }, (_, i) => `bloblessRenameSource${i}();`);
		write(fork, 'product/blobless-source.ts', `${source.join('\n')}\n`);
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add blobless rename source']);
		const oldBlob = git(fork, ['rev-parse', 'HEAD:product/blobless-source.ts']);
		git(fork, ['mv', 'product/blobless-source.ts', 'product/blobless-renamed.ts']);
		write(
			fork,
			'product/blobless-renamed.ts',
			`${[...source.slice(0, 4), ...Array.from({ length: 8 }, (_, i) => `bloblessRewrite${i}();`)].join('\n')}\n`
		);
		git(fork, ['commit', '-qam', 'rename and rewrite blobless source']);

		const origin = git(fork, ['remote', 'get-url', 'origin']);
		git(origin, ['config', 'uploadpack.allowFilter', 'true']);
		git(origin, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
		git(fork, ['push', '-q', '--force', 'origin', 'HEAD:main']);
		const clone = join(tmp, 'blobless-clone');
		git(tmp, ['clone', '-q', '--filter=blob:none', `file://${origin}`, clone]);
		git(clone, ['remote', 'add', 'upstream', upstream]);
		git(clone, ['fetch', '-q', 'upstream']);
		const missing = spawnSync('git', ['cat-file', '-e', oldBlob], {
			cwd: clone,
			env: fixtureGitEnv({ GIT_NO_LAZY_FETCH: '1' })
		});
		expect(missing.status).not.toBe(0);

		const r = run(clone, [
			'--base',
			'HEAD',
			'--fetch',
			'--json',
			'--all',
			'product/blobless-renamed.ts'
		]);
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'product/blobless-renamed.ts');
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/local history is incomplete/);
	});

	it('follows exact ancestry across a historical copy', () => {
		const source = Array.from({ length: 8 }, (_, i) => `copyTemplateToken${i}();`);
		for (const repo of [upstream, fork]) {
			write(repo, 'shared/copy-source.ts', `${source.join('\n')}\n`);
			git(repo, ['add', '-A']);
			git(repo, ['commit', '-qm', 'add copy source']);
		}
		git(fork, ['fetch', '-q', 'upstream']);
		write(
			fork,
			'product/copied-and-customized.ts',
			`${[...source.slice(0, 3), 'copyForkThree();', 'copyForkFour();', 'copyForkFive();', 'copyForkSix();', 'copyForkSeven();'].join('\n')}\n`
		);
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'copy and customize source']);
		markBase(fork);
		write(
			fork,
			'product/copied-and-customized.ts',
			`${[...source.slice(0, 2), 'copyFeatureEdit();', 'copyForkThree();', 'copyForkFour();', 'copyForkFive();', 'copyForkSix();', 'copyForkSeven();'].join('\n')}\n`
		);
		git(fork, ['commit', '-qam', 'edit customized copy']);

		const r = run(fork, ['--fetch', '--json', '--all']);
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find(
			(entry) => entry.path === 'product/copied-and-customized.ts'
		);
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/content is upstream elsewhere/);
	});

	it('keeps exact ancestry after the source leaves the upstream tip', () => {
		const source = Array.from({ length: 6 }, (_, i) => `export const removedUpstream${i} = ${i};`);
		write(upstream, 'shared/removed-source.ts', `${source.join('\n')}\n`);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add removable source']);
		write(fork, 'product/removed-source-copy.ts', `${source.join('\n')}\n`);
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'copy exact source']);
		write(fork, 'product/removed-source-copy.ts', 'alphaForkOnly();\nbetaForkOnly();\n');
		git(fork, ['commit', '-qam', 'rewrite before base']);
		markBase(fork);
		write(upstream, 'shared/removed-source.ts', 'zuluTemplate();\nyankeeTemplate();\n');
		git(upstream, ['commit', '-qam', 'rewrite upstream source']);
		write(fork, 'product/removed-source-copy.ts', 'alphaForkOnly();\ngammaFeature();\n');
		git(fork, ['commit', '-qam', 'edit rewritten copy']);

		const r = run(fork, ['--fetch', '--json', '--all']);
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find(
			(entry) => entry.path === 'product/removed-source-copy.ts'
		);
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/content is upstream elsewhere/);
	});

	it('compares text with historical upstream blobs', () => {
		const source = Array.from({ length: 8 }, (_, i) => `historicalTemplateToken${i}();`);
		write(upstream, 'shared/historical-text-source.ts', `${source.join('\n')}\n`);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add historical text source']);
		write(
			fork,
			'product/historical-text-copy.ts',
			`${[...source.slice(0, 5), 'customFive();', 'customSix();', 'customSeven();'].join('\n')}\n`
		);
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add customized historical copy']);
		markBase(fork);
		write(upstream, 'shared/historical-text-source.ts', 'newTemplateOne();\nnewTemplateTwo();\n');
		git(upstream, ['commit', '-qam', 'replace historical text source']);
		write(
			fork,
			'product/historical-text-copy.ts',
			`${[...source.slice(0, 5), 'featureEdit();', 'customSix();', 'customSeven();'].join('\n')}\n`
		);
		git(fork, ['commit', '-qam', 'edit customized historical copy']);

		const r = run(fork, ['--fetch', '--json', '--all']);
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find(
			(entry) => entry.path === 'product/historical-text-copy.ts'
		);
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toContain('shared/historical-text-source.ts');
	});

	it('bounds widened historical blob reads', () => {
		for (let i = 0; i < 12; i++) {
			write(
				upstream,
				`history/scale-${i}.scale`,
				`${Array.from({ length: 10 }, (_, line) => `upstreamScale${i}Token${line}();`).join('\n')}\n`
			);
		}
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add blob scale history']);
		write(
			fork,
			'product/scale-copy.scale',
			`${[
				...Array.from({ length: 8 }, (_, line) => `upstreamScale0Token${line}();`),
				'localScaleEight();',
				'localScaleNine();'
			].join('\n')}\n`
		);
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add scale comparison']);

		const r = run(fork, ['--fetch', '--json', '--all'], {
			NODE_ENV: 'test',
			UPSTREAM_REPORT_TEST_BLOB_OUTPUT_LIMIT: '2048'
		});
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'product/scale-copy.scale');
		expect(verdict?.note).toContain('history/scale-0.scale');
	});

	it('bounds retained historical similarity data', () => {
		const source = Array.from({ length: 10 }, (_, i) => `boundedSimilarityToken${i}();`);
		write(upstream, 'history/z-bounded-source.ts', `${source.join('\n')}\n`);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add bounded similarity source']);
		for (let i = 0; i < 6; i++) {
			write(
				upstream,
				`history/filler-${i}.ts`,
				`${Array.from({ length: 10 }, (_, line) => `boundedFiller${i}Token${line}();`).join('\n')}\n`
			);
		}
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add bounded similarity fillers']);
		write(
			fork,
			'product/local-bounded-copy.ts',
			`${[...source.slice(0, 8), 'localBoundedEight();', 'localBoundedNine();'].join('\n')}\n`
		);

		const r = run(fork, ['--fetch', '--json', '--all'], {
			NODE_ENV: 'test',
			UPSTREAM_REPORT_TEST_BLOB_OUTPUT_LIMIT: '4096'
		});
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'product/local-bounded-copy.ts');
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/one or more upstream blobs are absent/);
	});

	it('bounds retained local historical blobs', () => {
		const inherited = Array.from({ length: 12 }, (_, i) => `boundedLocalHistoryToken${i}();`);
		write(upstream, 'history/local-history-source.ts', `${inherited.join('\n')}\n`);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add local history source']);
		git(fork, ['fetch', '-q', 'upstream']);
		write(
			fork,
			'product/local-history-copy.ts',
			`${[...inherited.slice(0, 8), 'localHistoryEight();', 'localHistoryNine();', 'localHistoryTen();', 'localHistoryEleven();'].join('\n')}\n`
		);
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'copy bounded local history source']);
		for (let revision = 0; revision < 6; revision++) {
			write(
				fork,
				'product/local-history-copy.ts',
				`${Array.from({ length: 8 }, (_, line) => `localRevision${revision}Token${line}();`).join('\n')}\n`
			);
			git(fork, ['commit', '-qam', `rewrite local history ${revision}`]);
		}

		const r = run(fork, ['--fetch', '--json', '--all', 'product/local-history-copy.ts'], {
			NODE_ENV: 'test',
			UPSTREAM_REPORT_TEST_BLOB_OUTPUT_LIMIT: '2048'
		});
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'product/local-history-copy.ts');
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/bounded local-history capture/);
	});

	it('bounds local history process count', () => {
		write(fork, 'product/history-operation-limit.ts', 'historyOperationOne();\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add operation-limited history']);
		markBase(fork);
		write(fork, 'product/history-operation-limit.ts', 'historyOperationTwo();\n');
		git(fork, ['commit', '-qam', 'rewrite operation-limited history']);

		const r = run(fork, ['--fetch', '--json', '--all', 'product/history-operation-limit.ts'], {
			NODE_ENV: 'test',
			UPSTREAM_REPORT_TEST_HISTORY_OPERATION_LIMIT: '1'
		});
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find(
			(entry) => entry.path === 'product/history-operation-limit.ts'
		);
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/local history is incomplete/);
	});

	itWithGitWrapper('times out a stalled local history command', () => {
		write(fork, 'product/history-timeout.ts', 'historyTimeoutOne();\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add history timeout path']);
		markBase(fork);
		write(fork, 'product/history-timeout.ts', 'historyTimeoutTwo();\n');
		git(fork, ['commit', '-qam', 'rewrite history timeout path']);

		const r = run(fork, ['--fetch', '--json', '--all', 'product/history-timeout.ts'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			NODE_ENV: 'test',
			SLOW_HISTORY_LOG: '1',
			UPSTREAM_REPORT_TEST_HISTORY_TIMEOUT_MS: '50'
		});
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'product/history-timeout.ts');
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/local history is incomplete/);
	});

	itWithGitWrapper('times out stalled working-tree status inspection', () => {
		const r = run(fork, ['--json', 'shared/pristine.ts'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			NODE_ENV: 'test',
			SLOW_STATUS: '1',
			UPSTREAM_REPORT_TEST_WORKTREE_TIMEOUT_MS: '50'
		});
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/Git operation timed out/);
	});

	itWithGitWrapper('times out stalled changed-path diff inspection', () => {
		const r = run(fork, ['--json'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			NODE_ENV: 'test',
			SLOW_CHANGED_DIFF: '1',
			UPSTREAM_REPORT_TEST_DIFF_TIMEOUT_MS: '50'
		});

		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/Git operation timed out/);
	});

	itWithGitWrapper('times out a stalled upstream history walk', () => {
		write(fork, 'product/only-here.ts', 'export const product = false;\n');
		git(fork, ['commit', '-qam', 'edit fork path']);

		const r = run(fork, ['--fetch', '--json', '--all', 'product/only-here.ts'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			NODE_ENV: 'test',
			SLOW_UPSTREAM_HISTORY_LOG: '1',
			UPSTREAM_REPORT_TEST_HISTORY_TIMEOUT_MS: '50'
		});
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'product/only-here.ts');
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/upstream history did not complete/);
	});

	itWithGitWrapper('treats a truncated UTF-8 history record as incomplete', () => {
		write(fork, 'product/only-here.ts', 'export const product = false;\n');
		git(fork, ['commit', '-qam', 'edit fork path before partial history']);

		const r = run(fork, ['--fetch', '--json', '--all', 'product/only-here.ts'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			PARTIAL_INVALID_HISTORY: '1'
		});
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'product/only-here.ts');
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/upstream history did not complete/);
	});

	itWithGitWrapper('times out stalled upstream object typing', () => {
		write(fork, 'product/only-here.ts', 'export const product = false;\n');
		git(fork, ['commit', '-qam', 'edit fork path before object stall']);

		const r = run(fork, ['--fetch', '--json', '--all', 'product/only-here.ts'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			NODE_ENV: 'test',
			SLOW_UPSTREAM_OBJECT_CHECK: '1',
			UPSTREAM_REPORT_TEST_HISTORY_TIMEOUT_MS: '50'
		});
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'product/only-here.ts');
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/upstream history did not complete/);
	});

	itWithGitWrapper('times out a stalled repository root walk', () => {
		write(fork, 'product/only-here.ts', 'export const product = false;\n');
		git(fork, ['commit', '-qam', 'edit fork root path']);

		const r = run(fork, ['--fetch', '--json', '--all', 'product/only-here.ts'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			NODE_ENV: 'test',
			SLOW_ROOT_HISTORY: '1',
			UPSTREAM_REPORT_TEST_HISTORY_TIMEOUT_MS: '50'
		});
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'product/only-here.ts');
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/root history did not complete/);
	});

	itWithGitWrapper('times out a stalled repository tree scan', () => {
		const r = run(fork, ['--json'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			NODE_ENV: 'test',
			SLOW_TREE_SCAN: '1',
			UPSTREAM_REPORT_TEST_HISTORY_TIMEOUT_MS: '50'
		});

		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/Git operation timed out/);
	});

	itWithGitWrapper('does not require rev-list NUL output introduced in Git 2.50', () => {
		write(fork, 'product/portable-history.ts', 'forkOwnedHistoryOne();\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add portable history path']);
		markBase(fork);
		write(fork, 'product/portable-history.ts', 'forkOwnedHistoryTwo();\n');
		git(fork, ['commit', '-qam', 'edit portable history path']);
		const marker = join(tmp, 'rev-list-z-rejected');

		const r = run(fork, ['--fetch', '--json', '--all', 'product/portable-history.ts'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			REJECT_REV_LIST_Z_MARKER: marker
		});
		expect(r.status, r.stderr).toBe(0);
		expect(existsSync(marker)).toBe(false);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'product/portable-history.ts');
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/entered local history after repository creation/);
	});

	it('keeps absent paths unmeasured when local history is shallow', () => {
		const source = Array.from({ length: 6 }, (_, i) => `export const shallowInherited${i} = ${i};`);
		write(upstream, 'shared/shallow-source.ts', `${source.join('\n')}\n`);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add shallow source']);
		git(fork, ['fetch', '-q', 'upstream']);
		write(fork, 'product/shallow-copy.ts', `${source.join('\n')}\n`);
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'copy exact source']);
		write(fork, 'product/shallow-copy.ts', 'forkRewriteOne();\nforkRewriteTwo();\n');
		git(fork, ['commit', '-qam', 'rewrite before boundary']);
		const boundary = git(fork, ['rev-parse', 'HEAD']);
		markBase(fork);
		writeFileSync(join(fork, '.git', 'shallow'), `${boundary}\n`);
		write(fork, 'product/shallow-copy.ts', 'forkRewriteOne();\nfeatureEdit();\n');
		git(fork, ['commit', '-qam', 'edit after shallow boundary']);

		const r = run(fork, ['--fetch', '--json']);
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'product/shallow-copy.ts');
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/history is shallow/);
	});

	itWithGitWrapper('rejects a shallow boundary added after the completeness check', () => {
		write(fork, 'product/shallow-race.ts', 'shallowRaceOne();\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add shallow race history']);
		markBase(fork);
		write(fork, 'product/shallow-race.ts', 'shallowRaceTwo();\n');
		git(fork, ['commit', '-qam', 'edit shallow race history']);
		const marker = join(tmp, 'shallow-boundary-raced');

		const r = run(fork, ['--fetch', '--json', '--all', 'product/shallow-race.ts'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			ADD_SHALLOW_AFTER_CHECK_SHA: git(fork, ['rev-parse', 'HEAD']),
			CALLER_SHALLOW_PATH: join(fork, '.git', 'shallow'),
			SHALLOW_RACE_MARKER: marker
		});
		expect(existsSync(marker)).toBe(true);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/shallow boundary.*changed/);
	});

	itWithGitWrapper('pins local history through a shallow-boundary ABA race', () => {
		write(fork, 'product/shallow-aba.ts', 'shallowAbaOne();\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add shallow ABA path']);
		const boundary = git(fork, ['rev-parse', 'HEAD']);
		markBase(fork);
		write(fork, 'product/shallow-aba.ts', 'shallowAbaTwo();\n');
		git(fork, ['commit', '-qam', 'edit shallow ABA path']);
		const marker = join(tmp, 'shallow-boundary-aba');
		const shallowPath = join(fork, '.git', 'shallow');

		const r = run(fork, ['--fetch', '--json', '--all', 'product/shallow-aba.ts'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			ADD_SHALLOW_ABA_SHA: boundary,
			CALLER_SHALLOW_PATH: shallowPath,
			SHALLOW_ABA_MARKER: marker
		});
		expect(r.status, r.stderr).toBe(0);
		expect(existsSync(marker)).toBe(true);
		expect(existsSync(shallowPath)).toBe(false);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'product/shallow-aba.ts');
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/entered local history after repository creation/);
	});

	it('keeps staged ancestry when an unstaged edit replaces it', () => {
		const shared = Array.from({ length: 10 }, (_, i) => `export const stagedAncestor${i} = ${i};`);
		write(upstream, 'shared/staged-source.ts', `${shared.join('\n')}\n`);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add staged source']);
		git(fork, ['fetch', '-q', 'upstream']);

		write(
			fork,
			'product/staged-derived.ts',
			`${[...shared.slice(0, 6), 'forkA();', 'forkB();', 'forkC();', 'forkD();'].join('\n')}\n`
		);
		git(fork, ['add', 'product/staged-derived.ts']);
		write(fork, 'product/staged-derived.ts', 'unrelatedWorktree();\nmoreUnrelatedWorktree();\n');

		expect(verdicts(fork)['product/staged-derived.ts']).toBe('unmeasured');
	});

	itWithPosixPaths('keeps filtered unstaged bytes from proving fork ownership', () => {
		const canonical = 'export const upstreamCanonical = true;\n';
		write(upstream, 'shared/filter-source.ts', canonical);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add filter source']);
		const filter = join(tmp, 'canonical-filter');
		writeFileSync(filter, `#!/bin/sh\nprintf '${canonical}'\n`);
		chmodSync(filter, 0o755);
		write(fork, '.gitattributes', 'product/filtered.ts filter=canonical\n');
		write(fork, 'product/filtered.ts', 'forkOnlyBase();\nmoreForkOnlyBase();\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add filtered fork path']);
		git(fork, ['config', 'filter.canonical.clean', filter]);
		markBase(fork);
		const raw = 'rawWorkingCopyWithAQuiteDifferentLength();\nanotherRawLineWithMoreText();\n';
		write(fork, 'product/filtered.ts', raw);
		const canonicalSha = gitInput(
			fork,
			['hash-object', '--path=product/filtered.ts', '--stdin'],
			raw
		);
		expect(canonicalSha).toBe(git(upstream, ['rev-parse', 'HEAD:shared/filter-source.ts']));

		const r = run(fork, ['--fetch', '--json']);
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'product/filtered.ts');
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/clean filters/);
	});

	it('finds a template port whose extension changed', () => {
		const shared = Array.from({ length: 10 }, (_, i) => `const portable${i} = ${i};`);
		write(upstream, 'shared/portable.js', `${shared.join('\n')}\n`);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add portable script']);
		git(fork, ['fetch', '-q', 'upstream']);

		write(
			fork,
			'product/ported.ts',
			`${[...shared.slice(0, 7), 'const typedA: number = 1;', 'const typedB: number = 2;', 'const typedC: number = 3;'].join('\n')}\n`
		);
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'port script to typescript']);

		expect(verdicts(fork)['product/ported.ts']).toBe('unmeasured');
	});

	it('surfaces a comparison blocked by a missing upstream blob', () => {
		const shared = Array.from({ length: 8 }, (_, i) => `export const missing${i} = ${i};`);
		write(upstream, 'missing-source.ts', `${shared.join('\n')}\n`);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add unavailable source']);
		const tip = git(upstream, ['rev-parse', 'HEAD']);
		const tree = git(upstream, ['rev-parse', 'HEAD^{tree}']);
		const blob = git(upstream, ['rev-parse', 'HEAD:missing-source.ts']);
		copyObject(upstream, fork, 'tree', tree);
		copyObject(upstream, fork, 'commit', tip);
		git(fork, [
			'update-ref',
			'-m',
			'fetch upstream: storing head',
			'refs/remotes/upstream/main',
			tip
		]);
		expect(
			spawnSync('git', ['cat-file', '-e', blob], {
				cwd: fork,
				env: fixtureGitEnv({ GIT_NO_LAZY_FETCH: '1' })
			}).status
		).not.toBe(0);

		write(
			fork,
			'product/missing-derived.ts',
			`${[...shared.slice(0, 5), 'forkMissingA();', 'forkMissingB();', 'forkMissingC();'].join('\n')}\n`
		);
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add copy of unavailable source']);

		expect(verdicts(fork)['product/missing-derived.ts']).toBe('unmeasured');
	});

	itWithGitWrapper.each(['true', 'yes', 'on', '1'])(
		'requires Git 2.45 when promisor is spelled %s',
		(value) => {
			git(fork, ['config', 'remote.origin.promisor', value]);
			const r = run(fork, ['--json', 'shared/pristine.ts'], {
				PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
				REAL_GIT: realGitPath(),
				FAKE_GIT_VERSION: '2.43.0'
			});
			expect(r.status).not.toBe(0);
			expect(r.stderr).toMatch(/Git 2\.45 or newer.*partial-clone/);
		}
	);

	itWithGitWrapper('requires Git 2.45 for a valueless promisor declaration', () => {
		const config = join(fork, '.git', 'config');
		writeFileSync(config, `${readFileSync(config, 'utf8')}\n[remote "valueless"]\n\tpromisor\n`);
		const r = run(fork, ['--json', 'shared/pristine.ts'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			FAKE_GIT_VERSION: '2.43.0'
		});
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/Git 2\.45 or newer.*partial-clone/);
	});

	it('classifies a fork-only path as fork-only', () => {
		write(fork, 'product/only-here.ts', 'export const product = false;\n');
		git(fork, ['commit', '-qam', 'edit']);
		expect(verdicts(fork)['product/only-here.ts']).toBe('fork-only');
	});

	it('keeps a low-similarity port added after repository creation unmeasured', () => {
		const inherited = Array.from(
			{ length: 10 },
			(_, i) => `export const inheritedPortLine${i} = calculateInheritedPortValue(${i});`
		);
		write(upstream, 'shared/late-port-source.js', `${inherited.join('\n')}\n`);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add late port source']);
		git(fork, ['fetch', '-q', 'upstream']);
		const port = [
			...inherited.slice(0, 4),
			...Array.from({ length: 6 }, (_, i) => `// ${'z'.repeat(80 + i)}`)
		];
		write(fork, 'product/late-port.ts', `${port.join('\n')}\n`);
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add late low-similarity port']);
		markBase(fork);
		write(fork, 'product/late-port.ts', `${port.join('\n')}\nconst featureFix = true;\n`);
		git(fork, ['commit', '-qam', 'fix late port']);

		const r = run(fork, ['--fetch', '--json', '--all', 'product/late-port.ts']);
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'product/late-port.ts');
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/entered local history after repository creation/);
	});

	it('keeps imported root paths unmeasured', () => {
		const imported = join(tmp, 'imported-history');
		mkdirSync(imported);
		init(imported);
		write(imported, 'product/imported-port.ts', 'export const importedPort = true;\n');
		git(imported, ['add', '-A']);
		git(imported, ['commit', '-qm', 'add imported root path']);
		git(fork, ['fetch', '-q', imported, 'main']);
		git(fork, [
			'merge',
			'-q',
			'--allow-unrelated-histories',
			'--no-ff',
			'FETCH_HEAD',
			'-m',
			'import unrelated history'
		]);
		markBase(fork);
		write(fork, 'product/imported-port.ts', 'export const importedPort = false;\n');
		git(fork, ['commit', '-qam', 'fix imported path']);

		const r = run(fork, ['--fetch', '--json', '--all', 'product/imported-port.ts']);
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'product/imported-port.ts');
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/multiple root commits/);
	});

	it('keeps a case-folded marker provenance path visible after upstream deletes it', () => {
		const provenanceUpstream = join(tmp, 'provenance-template');
		mkdirSync(provenanceUpstream);
		init(provenanceUpstream);
		write(
			provenanceUpstream,
			'Legacy/Template-Port.ts',
			'export const inheritedOne = 1;\nexport const inheritedTwo = 2;\n'
		);
		git(provenanceUpstream, ['add', '-A']);
		git(provenanceUpstream, ['commit', '-qm', 'template with legacy path']);
		const forkPoint = git(provenanceUpstream, ['rev-parse', 'HEAD']);

		const provenanceFork = join(tmp, 'provenance-fork');
		mkdirSync(provenanceFork);
		init(provenanceFork);
		write(
			provenanceFork,
			'legacy/template-port.ts',
			'// zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz\n' +
				'// yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy\n'
		);
		write(
			provenanceFork,
			'.upstream-sync.json',
			JSON.stringify({
				upstreamUrl: provenanceUpstream,
				forkPoint,
				lastSynced: forkPoint
			})
		);
		git(provenanceFork, ['add', '-A']);
		git(provenanceFork, ['commit', '-qm', 'content-copy root']);
		const provenanceOrigin = join(tmp, 'provenance-origin.git');
		mkdirSync(provenanceOrigin);
		git(provenanceOrigin, ['init', '--bare', '-q']);
		git(provenanceFork, ['remote', 'add', 'origin', provenanceOrigin]);
		git(provenanceFork, ['remote', 'add', 'upstream', provenanceUpstream]);
		git(provenanceFork, ['fetch', '-q', 'upstream']);
		markBase(provenanceFork);

		git(provenanceUpstream, ['rm', '-q', 'Legacy/Template-Port.ts']);
		git(provenanceUpstream, ['commit', '-qm', 'remove legacy path']);
		write(
			provenanceFork,
			'legacy/template-port.ts',
			'// zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz\n' +
				'// xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n'
		);
		git(provenanceFork, ['commit', '-qam', 'fix retained legacy path']);

		const r = run(provenanceFork, ['--fetch', '--json', '--all', 'legacy/template-port.ts']);
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'legacy/template-port.ts');
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/marker provenance|\.upstream-sync\.json provenance/);
	});

	it('keeps absences unmeasured after upstream rewrites its history', () => {
		git(upstream, ['checkout', '-q', '--orphan', 'rewritten-main']);
		git(upstream, ['rm', '-q', '-rf', '.']);
		write(upstream, 'rewritten-root.txt', 'upstream history was replaced\n');
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'replace upstream history']);
		git(upstream, ['branch', '-M', 'main']);

		write(
			fork,
			'shared/rewritten.ts',
			'export const retainedTemplatePort = false;\nexport const localFix = true;\n'
		);
		git(fork, ['commit', '-qam', 'fix retained template file']);

		const r = run(fork, ['--fetch', '--json', '--all', 'shared/rewritten.ts']);
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'shared/rewritten.ts');
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/provenance is not reachable/);
	});

	it('refuses to run when the base is missing instead of reporting an empty diff', () => {
		// The failure this exists for: without `origin/main` an earlier version
		// fell back to HEAD, so `HEAD...HEAD` was empty and a branch full of
		// template fixes reported "nothing to report upstream", exit 0.
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 99;\n');
		git(fork, ['commit', '-qam', 'fix']);
		git(fork, ['update-ref', '-d', 'refs/remotes/origin/main']);

		const r = run(fork, []);
		expect(r.status).not.toBe(0);
		expect(r.stdout).not.toContain('Nothing to report upstream');
		expect(r.stderr).toMatch(/origin\/main/);
	});

	it('refuses a base that shares no history with HEAD', () => {
		// `upstream/main` is a real unrelated root in this fixture, which is what
		// a template fork looks like. Enumeration runs from the merge base, so
		// without one it enumerates nothing and reads as a clean report.
		const r = run(fork, ['--base', 'refs/remotes/upstream/main']);
		expect(r.status).not.toBe(0);
		expect(r.stdout).not.toContain('Nothing to report upstream');
		// The script's own refusal. Letting git fail on its own would pass this
		// too, and would not say the run stopped for the right reason.
		expect(r.stderr).toContain('Refusing to compare unrelated histories');
	});

	it('refuses multiple best merge bases instead of choosing one', () => {
		const root = git(fork, ['rev-parse', 'HEAD']);
		git(fork, ['checkout', '-q', '-b', 'criss-a', root]);
		write(fork, 'product/criss-cross.ts', 'export const side = "a";\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add side a']);
		const sideA = git(fork, ['rev-parse', 'HEAD']);
		const treeA = git(fork, ['rev-parse', `${sideA}^{tree}`]);

		git(fork, ['checkout', '-q', '-b', 'criss-b', root]);
		write(fork, 'product/criss-cross.ts', 'export const side = "b";\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add side b']);
		const sideB = git(fork, ['rev-parse', 'HEAD']);
		const treeB = git(fork, ['rev-parse', `${sideB}^{tree}`]);

		const head = gitInput(fork, ['commit-tree', treeA, '-p', sideA, '-p', sideB], 'keep side a\n');
		const main = gitInput(fork, ['commit-tree', treeB, '-p', sideB, '-p', sideA], 'keep side b\n');
		git(fork, ['checkout', '-q', '--detach', head]);
		advertiseOriginMain(fork, main);
		git(fork, ['update-ref', '-m', 'fetch origin: fast-forward', 'refs/remotes/origin/main', main]);

		const r = run(fork, ['--json']);
		expect(r.status).not.toBe(0);
		expect(r.stdout).not.toContain('Nothing to report upstream');
		expect(r.stderr).toMatch(/multiple best merge bases/);
	});

	it('ignores inherited graft files when validating base ancestry', () => {
		const head = git(fork, ['rev-parse', 'HEAD']);
		const emptyTree = gitInput(fork, ['mktree'], '');
		const unrelated = git(fork, ['commit-tree', emptyTree, '-m', 'unrelated base']);
		advertiseOriginMain(fork, unrelated);
		git(fork, [
			'update-ref',
			'-m',
			'fetch origin: fast-forward',
			'refs/remotes/origin/main',
			unrelated
		]);
		const graft = join(tmp, 'grafts');
		writeFileSync(graft, `${unrelated} ${head}\n`);

		const r = run(fork, ['--json'], { GIT_GRAFT_FILE: graft });
		expect(r.status).not.toBe(0);
		expect(r.stdout).not.toContain('Nothing to report upstream');
		expect(r.stderr).toContain('Refusing to compare unrelated histories');
	});

	it('ignores repository-local graft files', () => {
		const head = git(fork, ['rev-parse', 'HEAD']);
		const emptyTree = gitInput(fork, ['mktree'], '');
		const unrelated = git(fork, ['commit-tree', emptyTree, '-m', 'unrelated base']);
		advertiseOriginMain(fork, unrelated);
		git(fork, [
			'update-ref',
			'-m',
			'fetch origin: fast-forward',
			'refs/remotes/origin/main',
			unrelated
		]);
		writeFileSync(join(fork, '.git', 'info', 'grafts'), `${unrelated} ${head}\n`);

		const r = run(fork, ['--json']);
		expect(r.status).not.toBe(0);
		expect(r.stdout).not.toContain('Nothing to report upstream');
		expect(r.stderr).toContain('Refusing to compare unrelated histories');
	});

	it('does not trust a planted graft at the former shared temporary path', () => {
		const head = git(fork, ['rev-parse', 'HEAD']);
		const emptyTree = gitInput(fork, ['mktree'], '');
		const unrelated = git(fork, ['commit-tree', emptyTree, '-m', 'unrelated base']);
		advertiseOriginMain(fork, unrelated);
		git(fork, [
			'update-ref',
			'-m',
			'fetch origin: fast-forward',
			'refs/remotes/origin/main',
			unrelated
		]);
		const controlledTmp = join(tmp, 'controlled-tmp');
		mkdirSync(controlledTmp);
		writeFileSync(join(controlledTmp, 'upstream-relevance-no-grafts'), `${unrelated} ${head}\n`);

		const r = run(fork, ['--json'], { TMPDIR: controlledTmp });
		expect(r.status).not.toBe(0);
		expect(r.stdout).not.toContain('Nothing to report upstream');
		expect(r.stderr).toContain('Refusing to compare unrelated histories');
	});

	it('refuses an unresolvable explicit base', () => {
		const escape = String.fromCharCode(27);
		const bidi = String.fromCharCode(0x202e);
		const base = `refs/remotes/origin/${escape}[2J${bidi}does-not-exist`;
		const r = run(fork, ['--base', base, 'shared/pristine.ts']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/does not resolve/i);
		expect(r.stderr).not.toContain(escape);
		expect(r.stderr).not.toContain(bidi);
		expect(r.stderr).toContain('\\u001b[2J\\u202edoes-not-exist');
	});

	it('refuses an origin that resolves to the current checkout', () => {
		git(fork, ['remote', 'set-url', 'origin', fork]);
		git(fork, [
			'update-ref',
			'-m',
			'fetch origin: fast-forward',
			'refs/remotes/origin/main',
			'HEAD'
		]);
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 99;\n');
		git(fork, ['commit', '-qam', 'committed change hidden by self origin']);
		git(fork, [
			'update-ref',
			'-m',
			'fetch origin: fast-forward',
			'refs/remotes/origin/main',
			'HEAD'
		]);

		const r = run(fork, ['--json']);

		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/origin URL resolves inside a checkout/);
		expect(r.stdout).not.toContain('Nothing to report upstream');
	});

	it('refuses origin URLs owned by a sibling worktree', () => {
		const sibling = join(tmp, 'origin-sibling');
		git(fork, ['worktree', 'add', '-q', '-b', 'origin-sibling', sibling, 'HEAD']);
		const siblingGitDir = git(sibling, ['rev-parse', '--path-format=absolute', '--git-dir']);

		for (const url of [sibling, siblingGitDir]) {
			git(fork, ['remote', 'set-url', 'origin', url]);
			const r = run(fork, ['--json']);
			expect(r.status).not.toBe(0);
			expect(r.stderr).toMatch(/origin URL resolves inside a checkout or Git directory owned/);
		}
	});

	it('refuses a marker upstream owned by a sibling worktree', () => {
		const sibling = join(tmp, 'upstream-sibling');
		git(fork, ['worktree', 'add', '-q', '-b', 'upstream-sibling', sibling, 'HEAD']);
		const marker = JSON.parse(readFileSync(join(fork, '.upstream-sync.json'), 'utf8')) as Record<
			string,
			unknown
		>;
		write(fork, '.upstream-sync.json', JSON.stringify({ ...marker, upstreamUrl: sibling }));
		git(fork, ['commit', '-qam', 'point marker at sibling']);
		git(fork, ['remote', 'set-url', 'upstream', sibling]);

		const r = run(fork, ['--json']);

		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/marker upstream URL resolves inside a checkout/);
	});

	it('refuses a repository-contained Git bundle as marker upstream', () => {
		const decoy = join(tmp, 'bundle-decoy');
		git(tmp, ['clone', '-q', upstream, decoy]);
		git(decoy, ['config', 'user.email', 'test@example.com']);
		git(decoy, ['config', 'user.name', 'Test']);
		git(decoy, ['rm', '-q', 'shared/pristine.ts']);
		git(decoy, ['commit', '-qm', 'remove shared path']);
		const bundle = join(fork, 'forged.bundle');
		git(decoy, ['bundle', 'create', bundle, 'main']);
		const marker = JSON.parse(readFileSync(join(fork, '.upstream-sync.json'), 'utf8')) as Record<
			string,
			unknown
		>;
		write(fork, '.upstream-sync.json', JSON.stringify({ ...marker, upstreamUrl: 'forged.bundle' }));
		git(fork, ['add', '.upstream-sync.json', 'forged.bundle']);
		git(fork, ['commit', '-qm', 'add forged parent bundle']);
		markBase(fork);
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 99;\n');
		git(fork, ['commit', '-qam', 'fix shared path']);
		git(fork, ['remote', 'remove', 'upstream']);
		git(fork, ['update-ref', '-d', 'refs/remotes/upstream/main']);

		const r = run(fork, ['--fetch', '--json', 'shared/pristine.ts']);

		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/marker upstream URL resolves inside a checkout/);
	});

	it('refuses when the upstream remote points somewhere else than the marker', () => {
		// Squatting on the conventional `upstream` name is common, and a parent fork
		// is the usual case. Classifying against the wrong tree yields a full set
		// of plausible wrong verdicts, so it has to be fatal instead of quiet.
		const other = join(tmp, 'other');
		mkdirSync(other);
		init(other);
		write(other, 'unrelated.ts', 'export const x = 1;\n');
		git(other, ['add', '-A']);
		git(other, ['commit', '-qm', 'other']);
		git(fork, ['remote', 'set-url', 'upstream', other]);

		const r = run(fork, ['shared/pristine.ts']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/different repository/i);
	});

	it.skipIf(process.platform === 'win32')(
		'aborts when another worktree swaps the shared upstream remote during startup',
		() => {
			const other = join(tmp, 'other-upstream');
			mkdirSync(other);
			init(other);
			write(other, 'other.ts', 'export const other = 1;\n');
			git(other, ['add', '-A']);
			git(other, ['commit', '-qm', 'other upstream']);

			const wrapper = installGitWrapper(tmp);
			const r = run(fork, ['shared/pristine.ts'], {
				PATH: `${wrapper}:${process.env.PATH ?? ''}`,
				REAL_GIT: realGitPath(),
				SWAP_REMOTE: other,
				SWAP_MARKER: join(tmp, 'remote-swapped')
			});
			expect(r.status).not.toBe(0);
			expect(r.stdout).not.toContain('Nothing to report upstream');
			expect(r.stderr).toContain('changed while this report started');
		}
	);

	itWithGitWrapper('binds an allowed fetch to the checked upstream URL', () => {
		const decoy = join(tmp, 'fetch-decoy');
		mkdirSync(decoy);
		init(decoy);
		write(decoy, 'decoy.ts', 'export const decoy = true;\n');
		git(decoy, ['add', '-A']);
		git(decoy, ['commit', '-qm', 'decoy']);
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 91;\n');
		git(fork, ['commit', '-qam', 'fix shared file']);

		const wrapper = installGitWrapper(tmp);
		const marker = join(tmp, 'remote-aba');
		const r = run(fork, ['--fetch', '--json', 'shared/pristine.ts'], {
			PATH: `${wrapper}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			ABA_REPO: fork,
			ABA_DECOY_REMOTE: decoy,
			ABA_EXPECTED_REMOTE: upstream,
			ABA_REMOTE_MARKER: marker
		});

		expect(r.status, r.stderr).toBe(0);
		expect(existsSync(marker)).toBe(true);
		expect(git(fork, ['remote', 'get-url', 'upstream'])).toBe(upstream);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string }>;
		};
		expect(parsed.verdicts[0]?.relevance).toBe('pristine');
	});

	itWithPosixPaths('ignores an upstream upload-pack that redirects the checked URL', () => {
		const decoy = join(tmp, 'upload-pack-decoy');
		mkdirSync(decoy);
		init(decoy);
		write(decoy, 'decoy.ts', 'export const decoy = true;\n');
		git(decoy, ['add', '-A']);
		git(decoy, ['commit', '-qm', 'add upload-pack decoy']);
		const marker = join(tmp, 'custom-upload-pack-used');
		const uploadPack = join(tmp, 'custom-upload-pack');
		writeFileSync(
			uploadPack,
			`#!/bin/sh\nprintf 'used\\n' >> "${marker}"\nexec git-upload-pack "${decoy}"\n`
		);
		chmodSync(uploadPack, 0o755);
		git(fork, ['config', 'remote.upstream.uploadpack', uploadPack]);

		const r = run(fork, ['--fetch', '--json', 'shared/pristine.ts']);
		expect(r.status, r.stderr).toBe(0);
		expect(existsSync(marker)).toBe(false);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ relevance: string }>;
		};
		expect(parsed.verdicts[0]?.relevance).toBe('pristine');
	});

	itWithPosixPaths('refuses an SSH command that redirects the checked URL', () => {
		const markerBefore = JSON.parse(readFileSync(join(fork, '.upstream-sync.json'), 'utf8')) as {
			forkPoint: string;
		};
		const decoy = join(tmp, 'ssh-command-decoy.git');
		mkdirSync(decoy);
		git(decoy, ['init', '--bare', '-q']);
		git(upstream, ['push', '-q', decoy, `${markerBefore.forkPoint}:refs/heads/main`]);

		write(upstream, 'product/only-here.ts', 'export const product = true;\n');
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add product path upstream']);
		write(fork, 'product/only-here.ts', 'export const product = false;\n');
		git(fork, ['commit', '-qam', 'fix product path']);

		const markerUrl = 'ssh://example.invalid/template.git';
		write(
			fork,
			'.upstream-sync.json',
			JSON.stringify({
				upstreamUrl: markerUrl,
				forkPoint: markerBefore.forkPoint,
				lastSynced: markerBefore.forkPoint
			})
		);
		git(fork, ['commit', '-qam', 'set SSH upstream marker']);
		git(fork, ['remote', 'set-url', 'upstream', markerUrl]);
		const used = join(tmp, 'ssh-command-used');
		const sshCommand = join(tmp, 'redirect-ssh');
		writeFileSync(
			sshCommand,
			`#!/bin/sh\nprintf 'used\\n' >> "${used}"\nexec git-upload-pack "${decoy}"\n`
		);
		chmodSync(sshCommand, 0o755);
		git(fork, ['config', 'core.sshCommand', sshCommand]);
		git(fork, ['config', 'ssh.variant', 'simple']);

		const r = run(fork, ['--fetch', '--json', '--all']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/core\.sshCommand/);
		expect(existsSync(used)).toBe(false);
	});

	itWithPosixPaths('scrubs an inherited SSH command from trusted reads', () => {
		const markerBefore = JSON.parse(readFileSync(join(fork, '.upstream-sync.json'), 'utf8')) as {
			forkPoint: string;
		};
		const decoy = join(tmp, 'inherited-ssh-decoy.git');
		mkdirSync(decoy);
		git(decoy, ['init', '--bare', '-q']);
		git(upstream, ['push', '-q', decoy, `${markerBefore.forkPoint}:refs/heads/main`]);
		const markerUrl = 'ssh://example.invalid/template.git';
		write(
			fork,
			'.upstream-sync.json',
			JSON.stringify({
				upstreamUrl: markerUrl,
				forkPoint: markerBefore.forkPoint,
				lastSynced: markerBefore.forkPoint
			})
		);
		git(fork, ['commit', '-qam', 'set inherited SSH marker']);
		git(fork, ['remote', 'set-url', 'upstream', markerUrl]);
		git(fork, ['config', 'ssh.variant', 'simple']);
		const used = join(tmp, 'inherited-ssh-used');
		const sshCommand = join(tmp, 'inherited-redirect-ssh');
		writeFileSync(
			sshCommand,
			`#!/bin/sh\nprintf 'used\\n' >> "${used}"\nexec git-upload-pack "${decoy}"\n`
		);
		chmodSync(sshCommand, 0o755);

		const r = run(fork, ['--fetch', '--json'], {
			GIT_SSH_COMMAND: sshCommand,
			NODE_ENV: 'test',
			UPSTREAM_REPORT_TEST_TIMEOUT_MS: '1000'
		});
		expect(r.status).not.toBe(0);
		expect(existsSync(used)).toBe(false);
	});

	it('refuses a URL rewrite that redirects the marker transport', () => {
		const markerUrl = 'https://example.invalid/template.git';
		const decoy = join(tmp, 'instead-of-decoy');
		mkdirSync(decoy);
		init(decoy);
		write(decoy, 'decoy.ts', 'export const decoy = true;\n');
		git(decoy, ['add', '-A']);
		git(decoy, ['commit', '-qm', 'add instead-of decoy']);
		write(fork, '.upstream-sync.json', JSON.stringify({ upstreamUrl: markerUrl }));
		git(fork, ['commit', '-qam', 'set network-style upstream marker']);
		git(fork, ['remote', 'set-url', 'upstream', markerUrl]);
		git(fork, ['config', `url.${decoy}.insteadOf`, markerUrl]);

		const r = run(fork, ['--fetch', '--json']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/url\.\*\.insteadOf/);
		expect(r.stdout).not.toContain('Nothing to report upstream');
	});

	itWithGitWrapper('isolates network reads from a transport rewrite ABA race', () => {
		const markerBefore = JSON.parse(readFileSync(join(fork, '.upstream-sync.json'), 'utf8')) as {
			forkPoint: string;
		};
		const decoy = join(tmp, 'transport-rewrite-decoy.git');
		mkdirSync(decoy);
		git(decoy, ['init', '--bare', '-q']);
		git(upstream, ['push', '-q', decoy, `${markerBefore.forkPoint}:refs/heads/main`]);
		write(upstream, 'product/only-here.ts', 'export const product = true;\n');
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add product path upstream']);
		write(fork, 'product/only-here.ts', 'export const product = false;\n');
		git(fork, ['commit', '-qam', 'fix product path']);

		const marker = join(tmp, 'transport-rewrite-aba');
		const r = run(fork, ['--fetch', '--json', '--all', 'product/only-here.ts'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			TRANSPORT_REWRITE_REPO: fork,
			TRANSPORT_REWRITE_URL: upstream,
			TRANSPORT_REWRITE_TARGET: decoy,
			TRANSPORT_REWRITE_CHECKS: join(tmp, 'transport-rewrite-checks'),
			TRANSPORT_REWRITE_READS: join(tmp, 'transport-rewrite-reads'),
			TRANSPORT_REWRITE_MARKER: marker
		});
		expect(r.status, r.stderr).toBe(0);
		expect(existsSync(marker)).toBe(true);
		expect(git(fork, ['config', '--list'])).not.toContain(decoy);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string }>;
		};
		expect(parsed.verdicts[0]?.relevance).toBe('pristine');
	});

	it('refuses a symbolic upstream tracking ref before fetching', () => {
		const mainBefore = git(fork, ['rev-parse', 'refs/heads/main']);
		git(fork, ['symbolic-ref', 'refs/remotes/upstream/main', 'refs/heads/main']);

		const r = run(fork, ['--fetch', '--json', 'shared/pristine.ts']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/symbolic ref/);
		expect(git(fork, ['rev-parse', 'refs/heads/main'])).toBe(mainBefore);
	});

	itWithGitWrapper('refuses to overwrite a concurrent upstream ref update', () => {
		const expected = git(upstream, ['rev-parse', 'HEAD']);
		write(upstream, 'shared/ref-swap-decoy.ts', 'decoyRef();\n');
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add ref swap decoy']);
		const decoy = git(upstream, ['rev-parse', 'HEAD']);
		git(fork, ['fetch', '-q', 'upstream']);
		git(upstream, ['reset', '--hard', '-q', expected]);
		git(fork, ['fetch', '-q', 'upstream']);

		const wrapper = installGitWrapper(tmp);
		const marker = join(tmp, 'fetch-ref-swap');
		const r = run(fork, ['--fetch', '--json', '--all'], {
			PATH: `${wrapper}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			FETCH_REF_SWAP_REPO: fork,
			FETCH_REF_SWAP_SHA: decoy,
			FETCH_REF_SWAP_MARKER: marker
		});

		expect(existsSync(marker)).toBe(true);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/tracking ref changed while this report fetched objects/);
		expect(git(fork, ['rev-parse', 'refs/remotes/upstream/main'])).toBe(decoy);
	});

	itWithGitWrapper('does not write a fetched ref after the shared upstream URL changes', () => {
		const decoy = join(tmp, 'fetch-url-swap-decoy');
		mkdirSync(decoy);
		init(decoy);
		write(decoy, 'decoy.ts', 'export const decoy = true;\n');
		git(decoy, ['add', '-A']);
		git(decoy, ['commit', '-qm', 'add URL swap decoy']);
		const refBefore = git(fork, ['rev-parse', 'refs/remotes/upstream/main']);
		const fetchRecordBefore = gitOptional(fork, ['config', '--get', 'upstreamReport.lastFetch']);
		const marker = join(tmp, 'fetch-url-swap');

		const r = run(fork, ['--fetch', '--json', '--all'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			FETCH_URL_SWAP_REPO: fork,
			FETCH_URL_SWAP_REMOTE: decoy,
			FETCH_URL_SWAP_MARKER: marker
		});

		expect(existsSync(marker)).toBe(true);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/upstream URL changed while this report fetched objects/);
		expect(git(fork, ['rev-parse', 'refs/remotes/upstream/main'])).toBe(refBefore);
		expect(gitOptional(fork, ['config', '--get', 'upstreamReport.lastFetch'])).toBe(
			fetchRecordBefore
		);
	});

	it('does not overwrite FETCH_HEAD during an allowed fetch', () => {
		const fetchHead = join(fork, '.git', 'FETCH_HEAD');
		writeFileSync(fetchHead, 'caller-owned fetch state\n');

		const r = run(fork, ['--fetch', '--json', 'shared/pristine.ts']);
		expect(r.status, r.stderr).toBe(0);
		expect(readFileSync(fetchHead, 'utf8')).toBe('caller-owned fetch state\n');
	});

	it('writes no git state when the upstream copy is missing', () => {
		git(fork, ['remote', 'remove', 'upstream']);
		git(fork, ['update-ref', '-d', 'refs/remotes/upstream/main']);
		const refsBefore = git(fork, ['for-each-ref', '--format=%(refname)']);
		const indexBefore = statSync(join(fork, '.git', 'index')).mtimeMs;

		const r = run(fork, ['shared/pristine.ts']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/UNKNOWN/);
		// The point: asking the question must not add the remote or reach the
		// network. Both are shared state in a repository with linked worktrees.
		expect(git(fork, ['remote']).split('\n').filter(Boolean)).not.toContain('upstream');
		expect(git(fork, ['for-each-ref', '--format=%(refname)'])).toBe(refsBefore);
		expect(statSync(join(fork, '.git', 'index')).mtimeMs).toBe(indexBefore);
		expect(leakedIndexCopies(r.pid)).toEqual([]);
	});

	itWithPosixPaths('does not resolve a symlink when asking what a file resembles', () => {
		// git stores a symlink as the target path, a string, so reading through
		// the link compares a file the repository does not hold. Pointed outside
		// the tree it reads whatever the branch aimed it at, and the branch is
		// what every other decision here refuses to trust. Here the target is a
		// near-copy of a template file, so following the link reports a match
		// that exists nowhere in this repository.
		const outside = join(tmp, 'outside.ts');
		// Two of its three lines are shared/pristine.ts, so following the link
		// clears the resemblance threshold and reports a match.
		writeFileSync(outside, 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n');
		symlinkSync(outside, join(fork, 'product/link.ts'));
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add a link']);

		const r = run(fork, ['--fetch', '--json', 'product/link.ts']);
		expect(r.status).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ relevance: string; note?: string }>;
		};
		expect(parsed.verdicts[0]?.relevance).toBe('unmeasured');
		expect(parsed.verdicts[0]?.note).toContain('design judgment');
	});

	itWithPosixPaths('does not follow a symlink in an intermediate directory', () => {
		write(fork, 'product/linked/derived.ts', 'forkOnlyA();\nforkOnlyB();\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add tracked product file']);
		markBase(fork);

		const outside = join(tmp, 'outside-directory');
		mkdirSync(outside);
		write(outside, 'derived.ts', 'export const a = 1;\nexport const b = 2;\nexternal();\n');
		rmSync(join(fork, 'product/linked'), { recursive: true });
		symlinkSync(outside, join(fork, 'product/linked'));

		const r = run(fork, ['--json', 'product/linked/derived.ts']);
		expect(r.status, `script failed: ${r.stderr}`).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((item) => item.path === 'product/linked/derived.ts');
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toContain('parent "product/linked" is a symlink');
	});

	it('surfaces binary resemblance instead of decoding it as line text', () => {
		const source = Buffer.alloc(256, 0x61);
		source[10] = 0;
		const copy = Buffer.from(source);
		copy[255] = 0x62;
		writeFileSync(join(upstream, 'shared/source.blob'), source);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add binary source']);
		git(fork, ['fetch', '-q', 'upstream']);

		writeFileSync(join(fork, 'product/derived.blob'), copy);
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add binary copy']);

		expect(verdicts(fork)['product/derived.blob']).toBe('unmeasured');
	});

	it.each([
		['one short line', 'on\n', 'off\n'],
		['single-character lines', 'a\nb\nc\n', 'a\nb\nd\n']
	])('keeps compact %s unmeasured', (_name, upstreamText, forkText) => {
		write(upstream, 'shared/compact-source.txt', upstreamText);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add compact source']);
		write(fork, 'product/compact-copy.txt', forkText);
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add compact copy']);

		expect(verdicts(fork)['product/compact-copy.txt']).toBe('unmeasured');
	});

	it('finds a multiline copy transformed over an existing fork path', () => {
		const source = Array.from({ length: 8 }, (_, i) => `performTask${i}();`);
		write(upstream, 'shared/transformed-source.ts', `${source.join('\n')}\n`);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add transform source']);
		write(fork, 'product/transformed-copy.ts', 'originalForkOnly();\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add fork-owned base']);
		markBase(fork);
		write(
			fork,
			'product/transformed-copy.ts',
			`${source.map((line) => `await ${line}`).join('\n')}\n`
		);
		git(fork, ['commit', '-qam', 'replace with transformed copy']);

		expect(verdicts(fork)['product/transformed-copy.ts']).toBe('unmeasured');
	});

	it('finds a multiline upstream copy minified to one line', () => {
		const source = Array.from(
			{ length: 10 },
			(_, i) => `export const preservedIdentifier${i} = calculatePreservedValue(${i});`
		);
		write(upstream, 'shared/minified-source.ts', `${source.join('\n')}\n`);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add minified source']);
		write(fork, 'product/minified-copy.ts', 'originalForkOnly();\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add fork-owned base']);
		markBase(fork);
		write(fork, 'product/minified-copy.ts', `${source.join('')}extraForkCall();\n`);
		git(fork, ['commit', '-qam', 'replace with minified copy']);

		expect(verdicts(fork)['product/minified-copy.ts']).toBe('unmeasured');
	});

	it('finds a one-line derived file after a small edit', () => {
		write(upstream, 'shared/minified.js', 'const inherited=1;const shared=2;\n');
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add minified source']);

		write(fork, 'product/derived.js', 'const inherited=1;const shared=3;\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add minified copy']);

		expect(verdicts(fork)['product/derived.js']).toBe('unmeasured');
	});

	it('keeps NUL-free invalid UTF-8 with a newline unmeasured', () => {
		writeFileSync(
			join(upstream, 'shared/source.bytes'),
			Buffer.from([0xff, 0x41, 0x42, 0x43, 0x0a])
		);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add binary source']);

		writeFileSync(join(fork, 'product/derived.bytes'), Buffer.from([0xff, 0x41, 0x42, 0x44, 0x0a]));
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add binary copy']);

		expect(verdicts(fork)['product/derived.bytes']).toBe('unmeasured');
	});

	it('keeps a multiline Latin-1 source unmeasured', () => {
		const source = [
			'export const café = 1;',
			'export const inheritedA = 1;',
			'export const inheritedB = 2;',
			'export const inheritedC = 3;',
			'export const inheritedD = 4;',
			'export const inheritedE = 5;'
		].join('\n');
		writeFileSync(join(upstream, 'shared/latin-source.ts'), Buffer.from(`${source}\n`, 'latin1'));
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add latin1 source']);
		git(fork, ['fetch', '-q', 'upstream']);

		write(
			fork,
			'product/utf8-copy.ts',
			`${source}\nexport const forkOnlyA = 1;\nexport const forkOnlyB = 2;\n`
		);
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'convert copied source to utf8']);

		expect(verdicts(fork)['product/utf8-copy.ts']).toBe('unmeasured');
	});

	it('keeps cross-extension invalid UTF-8 evidence unmeasured', () => {
		const source = [
			'const café = 1;',
			'const inheritedA = 1;',
			'const inheritedB = 2;',
			'const inheritedC = 3;',
			'const inheritedD = 4;',
			'const inheritedE = 5;'
		].join('\n');
		writeFileSync(join(upstream, 'shared/legacy-port.js'), Buffer.from(`${source}\n`, 'latin1'));
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add cross-extension latin1 source']);
		git(fork, ['fetch', '-q', 'upstream']);

		write(fork, 'product/modern-port.ts', `${source}\nconst forkOnlyA = 1;\n`);
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'port latin1 source to typescript']);
		markBase(fork);
		write(
			fork,
			'product/modern-port.ts',
			`${source}\nconst forkOnlyA = 1;\nconst forkOnlyB = 2;\n`
		);
		git(fork, ['commit', '-qam', 'edit typescript port']);

		expect(verdicts(fork)['product/modern-port.ts']).toBe('unmeasured');
	});

	it('decodes UTF-16 text under an unlisted extension', () => {
		const source = 'const inheritedUtf16Source = true;\nconst inheritedUtf16Value = 2;\n';
		writeFileSync(
			join(upstream, 'shared/Localizable.strings'),
			Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(source, 'utf16le')])
		);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add cross-extension utf16 source']);
		git(fork, ['fetch', '-q', 'upstream']);

		write(fork, 'product/only-here.ts', `${source}const forkOnlyA = 1;\n`);
		git(fork, ['commit', '-qam', 'port utf16 source to typescript']);
		markBase(fork);
		write(fork, 'product/only-here.ts', `${source}const forkOnlyA = 1;\nconst forkOnlyB = 2;\n`);
		git(fork, ['commit', '-qam', 'edit utf16 typescript port']);

		expect(verdicts(fork)['product/only-here.ts']).toBe('unmeasured');
	});

	it('decodes BOM-prefixed UTF-16 without NUL bytes', () => {
		const source = '漢字漢字漢字漢字漢字漢字漢字漢字';
		const encoded = Buffer.from(source, 'utf16le');
		expect(encoded.includes(0)).toBe(false);
		const utf16Upstream = join(tmp, 'utf16-bom-upstream');
		mkdirSync(utf16Upstream);
		init(utf16Upstream);
		writeFileSync(
			join(utf16Upstream, 'Localizable.strings'),
			Buffer.concat([Buffer.from([0xff, 0xfe]), encoded])
		);
		git(utf16Upstream, ['add', '-A']);
		git(utf16Upstream, ['commit', '-qm', 'add UTF-16 source']);
		const forkPoint = git(utf16Upstream, ['rev-parse', 'HEAD']);
		const utf16Fork = join(tmp, 'utf16-bom-fork');
		mkdirSync(utf16Fork);
		init(utf16Fork);
		write(utf16Fork, 'product/port.ts', source);
		write(
			utf16Fork,
			'.upstream-sync.json',
			JSON.stringify({ upstreamUrl: utf16Upstream, forkPoint, lastSynced: forkPoint })
		);
		git(utf16Fork, ['add', '-A']);
		git(utf16Fork, ['commit', '-qm', 'create UTF-16 fork']);
		const origin = join(tmp, 'utf16-bom-origin.git');
		mkdirSync(origin);
		git(origin, ['init', '--bare', '-q']);
		git(utf16Fork, ['remote', 'add', 'origin', origin]);
		git(utf16Fork, ['remote', 'add', 'upstream', utf16Upstream]);
		git(utf16Fork, ['fetch', '-q', 'upstream']);
		markBase(utf16Fork);
		write(utf16Fork, 'product/port.ts', `${source}仮名`);
		git(utf16Fork, ['commit', '-qam', 'edit UTF-16 port']);

		const r = run(utf16Fork, ['--fetch', '--json', '--all', 'product/port.ts']);

		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		expect(parsed.verdicts[0]?.relevance).toBe('unmeasured');
		expect(parsed.verdicts[0]?.note).toMatch(/mostly matches upstream/);
	});

	it('adds the remote when --fetch is asked to recover a fresh clone', () => {
		// The documented recovery from a clone that has never seen the template.
		// Without the remote add, --fetch has nothing to fetch and the advice the
		// error gives is a dead end. The neighbouring no-write test cannot catch
		// that: it deliberately omits --fetch, and the refresh test starts from a
		// fixture that already has the remote.
		git(fork, ['remote', 'remove', 'upstream']);
		git(fork, ['update-ref', '-d', 'refs/remotes/upstream/main']);

		const r = run(fork, ['--fetch', 'shared/pristine.ts']);
		expect(r.status, `script failed: ${r.stderr}`).toBe(0);
		expect(git(fork, ['remote']).split('\n').filter(Boolean)).toContain('upstream');
		expect(git(fork, ['rev-parse', '--verify', 'refs/remotes/upstream/main'])).toBeTruthy();
	});

	itWithGitWrapper(
		'does not bind fetched objects to a remote changed during initial creation',
		() => {
			const decoy = join(tmp, 'remote-add-race-decoy');
			mkdirSync(decoy);
			init(decoy);
			write(decoy, 'decoy.ts', 'export const decoy = true;\n');
			git(decoy, ['add', '-A']);
			git(decoy, ['commit', '-qm', 'add remote-add decoy']);
			git(fork, ['remote', 'remove', 'upstream']);
			git(fork, ['update-ref', '-d', 'refs/remotes/upstream/main']);
			const marker = join(tmp, 'remote-add-swapped');

			const r = run(fork, ['--fetch', '--json', 'shared/pristine.ts'], {
				PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
				REAL_GIT: realGitPath(),
				ADD_REMOTE_SWAP_REMOTE: decoy,
				ADD_REMOTE_SWAP_MARKER: marker
			});

			expect(existsSync(marker)).toBe(true);
			expect(r.status).not.toBe(0);
			expect(r.stderr).toMatch(/upstream URL changed while this report fetched objects/);
			expect(git(fork, ['remote', 'get-url', 'upstream'])).toBe(decoy);
			expect(
				gitOptional(fork, ['rev-parse', '--verify', '--quiet', 'refs/remotes/upstream/main'])
			).toBe('');
			expect(gitOptional(fork, ['config', '--get', 'upstreamReport.lastFetch'])).toBe('');
		}
	);

	it('refuses a fetched remote that has no main branch', () => {
		const trunk = join(tmp, 'trunk-template');
		mkdirSync(trunk);
		init(trunk);
		write(trunk, 'trunk.ts', 'export const trunk = 1;\n');
		git(trunk, ['add', '-A']);
		git(trunk, ['commit', '-qm', 'trunk template']);
		git(trunk, ['branch', '-m', 'trunk']);

		write(fork, '.upstream-sync.json', JSON.stringify({ upstreamUrl: trunk }));
		git(fork, ['commit', '-qam', 'set trunk parent']);
		git(fork, ['remote', 'remove', 'upstream']);
		git(fork, ['update-ref', '-d', 'refs/remotes/upstream/main']);
		const r = run(fork, ['--fetch']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toContain('Could not fetch refs/heads/main');
		expect(r.stderr).not.toContain('already exists');
		expect(gitOptional(fork, ['config', '--get', 'remote.upstream.url'])).toBe('');
		expect(
			gitOptional(fork, ['rev-parse', '--verify', '--quiet', 'refs/remotes/upstream/main'])
		).toBe('');
		expect(gitOptional(fork, ['config', '--get', 'upstreamReport.lastFetch'])).toBe('');
	});

	it.skipIf(process.platform === 'win32')(
		'redacts a credential when a fresh fetch creates no main ref',
		() => {
			const secret = 's3cr3t-fetch-token';
			write(
				fork,
				'.upstream-sync.json',
				JSON.stringify({ upstreamUrl: `https://${secret}@example.invalid/template.git` })
			);
			git(fork, ['remote', 'remove', 'upstream']);
			git(fork, ['update-ref', '-d', 'refs/remotes/upstream/main']);
			const wrapper = installGitWrapper(tmp);
			const r = run(fork, ['--fetch', 'shared/pristine.ts'], {
				PATH: `${wrapper}:${process.env.PATH ?? ''}`,
				REAL_GIT: realGitPath(),
				FAKE_FETCH_SUCCESS: '1'
			});
			expect(r.status).not.toBe(0);
			expect(r.stderr).not.toContain(secret);
			expect(r.stderr).not.toContain('already exists');
		}
	);

	itWithGitWrapper('creates a missing remote from a standard SSH URL', () => {
		const marker = JSON.parse(readFileSync(join(fork, '.upstream-sync.json'), 'utf8')) as Record<
			string,
			unknown
		>;
		const sshUrl = 'ssh://git@github.com/stickerdaniel/saas-starter.git';
		write(fork, '.upstream-sync.json', JSON.stringify({ ...marker, upstreamUrl: sshUrl }));
		git(fork, ['commit', '-qam', 'set SSH parent']);
		markBase(fork);
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 99;\n');
		git(fork, ['commit', '-qam', 'fix shared path']);
		git(fork, ['remote', 'remove', 'upstream']);
		git(fork, ['update-ref', '-d', 'refs/remotes/upstream/main']);

		const r = run(fork, ['--base', 'origin/main', '--fetch', '--json', 'shared/pristine.ts'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			FAKE_FETCH_SUCCESS: '1',
			FAKE_REMOTE_MAIN_SHA: git(upstream, ['rev-parse', 'HEAD'])
		});

		expect(r.status, r.stderr).toBe(0);
		expect(git(fork, ['remote', 'get-url', 'upstream'])).toBe(sshUrl);
	});

	itWithGitWrapper('keeps SCP-style usernames out of shared remote creation', () => {
		const secret = 'DUMMY_SCP_CREATION_SECRET';
		const marker = JSON.parse(readFileSync(join(fork, '.upstream-sync.json'), 'utf8')) as Record<
			string,
			unknown
		>;
		const unsafeUrl = `${secret}@example.invalid:owner/template.git`;
		write(fork, '.upstream-sync.json', JSON.stringify({ ...marker, upstreamUrl: unsafeUrl }));
		git(fork, ['commit', '-qam', 'set SCP parent']);
		markBase(fork);
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 99;\n');
		git(fork, ['commit', '-qam', 'fix shared path']);
		git(fork, ['remote', 'remove', 'upstream']);
		git(fork, ['update-ref', '-d', 'refs/remotes/upstream/main']);
		const seen = join(tmp, 'scp-secret-in-argv');

		const r = run(fork, ['--base', 'origin/main', '--fetch', '--json', 'shared/pristine.ts'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			FAKE_FETCH_SUCCESS: '1',
			FAKE_REMOTE_MAIN_SHA: git(upstream, ['rev-parse', 'HEAD']),
			CHILD_ARG_SECRET: secret,
			CHILD_ARG_MARKER: seen
		});

		expect(r.status).not.toBe(0);
		expect(r.stderr).not.toContain(secret);
		expect(existsSync(seen)).toBe(false);
		expect(gitOptional(fork, ['remote', 'get-url', 'upstream'])).toBe('');
	});

	it('collects an edit that exists only in the index', () => {
		// Staging and then restoring the working tree leaves the change in the
		// index alone. The staged collector is the only one that can see it: the
		// worktree diff finds nothing, and the committed range has not moved.
		// Staging without restoring, which is what the neighbouring test does,
		// leaves the same bytes on disk and keeps that collector redundant.
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 99;\n');
		git(fork, ['add', 'shared/pristine.ts']);
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 2;\n');

		expect(verdicts(fork)['shared/pristine.ts']).toBe('pristine');
	});

	it('refuses automatic discovery with assume-unchanged entries', () => {
		git(fork, ['update-index', '--assume-unchanged', 'shared/pristine.ts']);
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 99;\n');

		const r = run(fork, []);
		expect(r.status).not.toBe(0);
		expect(r.stdout).not.toContain('Nothing to report upstream');
		expect(r.stderr).toContain('assume-unchanged');
		expect(r.stderr).toContain('shared/pristine.ts');
	});

	it('refuses automatic discovery with skip-worktree entries', () => {
		git(fork, ['update-index', '--skip-worktree', 'shared/pristine.ts']);
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 99;\n');

		const r = run(fork, []);
		expect(r.status).not.toBe(0);
		expect(r.stdout).not.toContain('Nothing to report upstream');
		expect(r.stderr).toContain('skip-worktree');
		expect(r.stderr).toContain('shared/pristine.ts');
	});

	it('refuses an explicit path hidden by an index flag', () => {
		git(fork, ['update-index', '--skip-worktree', 'product/only-here.ts']);

		const r = run(fork, ['--fetch', '--json', 'product/only-here.ts']);
		expect(r.status).not.toBe(0);
		expect(r.stdout).not.toContain('Nothing to report upstream');
		expect(r.stderr).toContain('skip-worktree');
		expect(r.stderr).toContain('product/only-here.ts');
	});

	it('classifies an explicit staged deletion introduced after the base', () => {
		write(fork, 'product/feature-file.ts', 'featureFile();\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add feature file']);
		git(fork, ['rm', '-q', 'product/feature-file.ts']);

		const r = run(fork, ['--fetch', '--json', '--all', 'product/feature-file.ts']);
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as { verdicts: Array<{ path: string }> };
		expect(parsed.verdicts.map((verdict) => verdict.path)).toContain('product/feature-file.ts');
	});

	it('resolves a path argument against the directory it was typed in', () => {
		// An agent runs from wherever it is working. Resolving arguments after the
		// chdir to the repository root reinterprets them against a directory the
		// caller never meant, and an argument that matches nothing is fatal, so
		// the run dies on a path that was correct when written.
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 99;\n');
		git(fork, ['commit', '-qam', 'fix']);

		const r = run(join(fork, 'product'), ['--json', '../shared/pristine.ts']);
		expect(r.status, `script failed: ${r.stderr}`).toBe(0);
		const parsed = JSON.parse(r.stdout) as { verdicts: Array<{ path: string }> };
		expect(parsed.verdicts.map((v) => v.path)).toEqual(['shared/pristine.ts']);
	});

	it('resolves a deleted relative path against the caller directory', () => {
		git(fork, ['rm', '-q', 'shared/pristine.ts']);
		git(fork, ['commit', '-qm', 'delete shared file']);

		const r = run(join(fork, 'shared'), ['--json', 'pristine.ts']);
		expect(r.status, `script failed: ${r.stderr}`).toBe(0);
		const parsed = JSON.parse(r.stdout) as { verdicts: Array<{ path: string; relevance: string }> };
		expect(parsed.verdicts).toEqual([
			expect.objectContaining({ path: 'shared/pristine.ts', relevance: 'pristine' })
		]);
	});

	it.skipIf(process.platform === 'win32')(
		'keeps a literal backslash in an explicit POSIX path',
		() => {
			const path = 'shared/a\\b.ts';
			for (const repo of [upstream, fork]) {
				write(repo, path, 'export const slash = 1;\n');
				git(repo, ['add', '-A']);
				git(repo, ['commit', '-qm', 'add backslash path']);
			}
			git(fork, ['fetch', '-q', 'upstream']);
			markBase(fork);
			write(fork, path, 'export const slash = 2;\n');

			expect(verdicts(fork, [path])[path]).toBe('pristine');
		}
	);

	it('does not close a one-day-old run with a clean bill of health', () => {
		// The age warning and the closing sentence must use the same threshold.
		// Two days was enough for this template to add seven paths, so a clean
		// verdict cannot survive a copy that is already two days old.
		const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
		const tip = git(fork, ['rev-parse', 'refs/remotes/upstream/main']);
		git(fork, ['update-ref', '-d', 'refs/remotes/upstream/main']);
		git(
			fork,
			['update-ref', '-m', 'fetch upstream: storing head', 'refs/remotes/upstream/main', tip],
			{
				GIT_COMMITTER_DATE: old
			}
		);
		write(fork, 'product/only-here.ts', 'export const product = false;\n');
		git(fork, ['commit', '-qam', 'edit']);

		const r = run(fork, []);
		expect(r.status).toBe(0);
		expect(r.stdout).not.toContain('Nothing to report upstream.');
		expect(r.stdout).toContain('--fetch');

		const json = run(fork, ['--json']);
		expect(json.status).toBe(0);
		expect((JSON.parse(json.stdout) as { upstreamStale: boolean }).upstreamStale).toBe(true);
	});

	it('keeps both the source and the destination path of a rename', () => {
		// Moving template code to a fork-only path is exactly the change worth
		// reporting, and `--name-only` prints only the destination, which is
		// fork-only, so the whole move disappears. `--name-status` is what keeps
		// both halves; `-M` beside it only decides whether git calls the pair a
		// rename or a delete plus an add, and either spelling yields both paths.
		git(fork, ['mv', 'shared/pristine.ts', 'product/moved.ts']);
		git(fork, ['commit', '-qm', 'move']);
		const v = verdicts(fork);
		expect(Object.keys(v)).toContain('shared/pristine.ts');
		expect(v['shared/pristine.ts']).toBe('pristine');
		// The destination answers too, or dropping `-M` would leave this green:
		// a rename then reads as one deletion plus one addition, and the source
		// still appears.
		expect(Object.keys(v)).toContain('product/moved.ts');
	});

	it('sees an untracked new file at a path upstream also has', () => {
		git(fork, ['rm', '-q', 'shared/pristine.ts']);
		git(fork, ['commit', '-qm', 'drop']);
		markBase(fork);
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const reAdded = true;\n');

		const v = verdicts(fork);
		expect(v['shared/pristine.ts']).toBe('unmeasured');
	});

	it('surfaces a changed shared binary instead of scoring it zero', () => {
		write(fork, 'shared/binary.bin', 'fork\u0000other');
		git(fork, ['commit', '-qam', 'binary']);
		expect(verdicts(fork)['shared/binary.bin']).toBe('unmeasured');
	});

	it('refuses Git paths that are not valid UTF-8', () => {
		const first = gitInput(fork, ['hash-object', '-w', '--stdin'], 'export const a = 1;\n');
		const second = gitInput(fork, ['hash-object', '-w', '--stdin'], 'forkOnly();\n');
		const records = Buffer.concat([
			Buffer.from(`100644 ${first} 0\tproduct/`),
			Buffer.from([0xfe]),
			Buffer.from('.ts\0'),
			Buffer.from(`100644 ${second} 0\tproduct/`),
			Buffer.from([0xff]),
			Buffer.from('.ts\0')
		]);
		gitInput(fork, ['update-index', '-z', '--index-info'], records);
		git(fork, ['commit', '-qm', 'add raw paths']);

		const r = run(fork, ['--fetch', '--json']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/pathname.*not valid UTF-8/);
	});

	it('keeps invalid UTF-8 shared content unmeasured', () => {
		writeFileSync(join(upstream, 'shared/invalid-text.ts'), Buffer.from([0xff, 0x20, 0x41]));
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add invalid source']);
		writeFileSync(join(fork, 'shared/invalid-text.ts'), Buffer.from([0xff, 0x20, 0x42]));
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add diverged invalid source']);
		git(fork, ['fetch', '-q', 'upstream']);
		markBase(fork);
		writeFileSync(join(fork, 'shared/invalid-text.ts'), Buffer.from([0xff, 0x20, 0x43]));
		git(fork, ['commit', '-qam', 'edit invalid source']);

		expect(verdicts(fork, ['shared/invalid-text.ts'])['shared/invalid-text.ts']).toBe('unmeasured');
	});

	it('handles a non-ASCII shared path', () => {
		// git quotes these by default ("enc\303\266ded"), and the quoted form then
		// fails when handed back to rev-parse, so the file silently ends up
		// unmeasured: a wrong answer that looks like a cautious one.
		write(fork, 'shared/encöded.ts', 'export const t = 1;\nexport const u = 99;\n');
		git(fork, ['commit', '-qam', 'edit encoded']);

		expect(verdicts(fork)['shared/encöded.ts']).toBe('pristine');
	});

	it('scores a change inside a fork-added block at zero, and still reports it', () => {
		write(
			fork,
			'shared/rewritten.ts',
			'export const template1 = 1;\nexport const template2 = 2;\nexport const template3 = 3;\nexport const template4 = 4;\nexport const template5 = 5;\nexport const template6 = 6;\nexport const template7 = 7;\nexport const template8 = 8;\nexport const forkOnly1 = 1;\nexport const forkOnly2 = 2;\nexport const forkOnly3 = 3;\nexport const forkOnly4 = 4;\nexport const forkOnly5 = 99;\nexport const forkOnly6 = 6;\nexport const forkOnly7 = 7;\nexport const forkOnly8 = 8;\n'
		);
		git(fork, ['commit', '-qam', 'fork block']);
		const r = run(fork, ['--json']);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; report: boolean }>;
		};
		const v = parsed.verdicts.find((x) => x.path === 'shared/rewritten.ts');
		expect(v?.relevance).toBe('diverged');
		// Zero is the honest score: nothing this change replaced exists upstream.
		// It is not grounds for silence, because the same score is produced by a
		// fix to a template line the fork had renamed.
		expect(v?.overlap).toBe(0);
		expect(v?.report).toBe(true);
	});

	it('reports a diverged file whose change replaced an actual upstream line', () => {
		// The positive counterpart to the case above, and the one whose absence
		// let a broken wiring stay green: with no test that a diverged file can
		// ever be reported, an implementation feeding empty upstream content to
		// every comparison would pass the whole suite.
		const lines = Array.from({ length: 8 }, (_, i) => `export const template${i + 1} = ${i + 1};`);
		lines[2] = 'export const template3 = 3333;';
		write(
			fork,
			'shared/rewritten.ts',
			lines.join('\n') +
				'\n' +
				Array.from({ length: 8 }, (_, i) => `export const forkOnly${i + 1} = ${i + 1};`).join(
					'\n'
				) +
				'\n'
		);
		git(fork, ['commit', '-qam', 'fix template line']);
		const r = run(fork, ['--json']);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; report: boolean; overlap?: number }>;
		};
		const v = parsed.verdicts.find((x) => x.path === 'shared/rewritten.ts');
		expect(v?.relevance).toBe('diverged');
		expect(v?.overlap).toBe(1);
		expect(v?.report).toBe(true);
	});

	it('collects an unstaged edit to a tracked file', () => {
		// Every other case commits first, so removing the working-tree collector
		// entirely would leave the suite green.
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 77;\n');
		expect(verdicts(fork)['shared/pristine.ts']).toBe('pristine');
	});

	it('collects a staged edit to a tracked file', () => {
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 78;\n');
		git(fork, ['add', 'shared/pristine.ts']);
		expect(verdicts(fork)['shared/pristine.ts']).toBe('pristine');
	});

	it('scores a staged diverged edit after the worktree is restored', () => {
		const path = join(fork, 'shared/rewritten.ts');
		const original = readFileSync(path, 'utf8');
		writeFileSync(path, original.replace('template8 = 8', 'template8 = 88'));
		git(fork, ['add', 'shared/rewritten.ts']);
		writeFileSync(path, original);

		const verdict = verdictsWithScore(fork, ['shared/rewritten.ts'])['shared/rewritten.ts'];
		expect(verdict?.relevance).toBe('diverged');
		expect(verdict?.overlap).toBe(1);
	});

	it('refuses an unknown option instead of treating its value as a path', () => {
		// `--bsae origin/main` parsed as a boolean flag plus a positional, and a
		// positional replaces the entire automatic file list. The run then checked
		// the literal path "origin/main", found nothing, and exited zero.
		const r = run(fork, ['--bsae', 'origin/main']);
		expect(r.status).not.toBe(0);
		expect(r.stdout).not.toContain('Nothing to report upstream');
	});

	it('escapes controls in an unknown-option diagnostic', () => {
		const escape = String.fromCharCode(27);
		const r = run(fork, [`--bad${escape}[2J`]);

		expect(r.status).not.toBe(0);
		expect(r.stderr).not.toContain(escape);
		expect(r.stderr).toContain('\\u001b[2J');
		expect(r.stderr).not.toContain('TypeError');
	});

	it('refuses an unknown option even when its value is a real path', () => {
		// The sharper version of the case above. With a nonexistent value the path
		// check catches it, so that test passes whether or not parsing is strict.
		// Here the stray value IS a real file, so only strict parsing objects.
		// Otherwise the run silently narrows to that one file and exits zero.
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 99;\n');
		git(fork, ['commit', '-qam', 'fix']);

		const r = run(fork, ['--bsae', 'shared/pristine.ts']);
		expect(r.status).not.toBe(0);
	});

	it('refuses an explicit path that does not exist', () => {
		const r = run(fork, ['shared/typo.ts']);
		expect(r.status).not.toBe(0);
		expect(r.stdout).not.toContain('Nothing to report upstream');
	});

	it('refuses a tracking ref with no remote behind it', () => {
		// An orphan `upstream/main` left by a former parent fork classifies every
		// path the real template has but that one lacks as fork-only: silent, and
		// wrong. Ref presence alone is not evidence of provenance.
		// `git remote remove` deletes the tracking refs too, so it cannot build
		// this case. Dropping the config section leaves the ref stranded, which is
		// exactly what a repointed or abandoned remote leaves behind.
		git(fork, ['config', '--remove-section', 'remote.upstream']);
		expect(git(fork, ['rev-parse', '--verify', '--quiet', 'refs/remotes/upstream/main'])).not.toBe(
			''
		);

		const r = run(fork, ['shared/pristine.ts']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/no `upstream` remote is configured/);
	});

	it('fails when a collector cannot run instead of reporting clean', () => {
		// A malformed inherited config made every `git diff` fail; each returned
		// an empty string, and four empty lists read as a clean tree.
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 55;\n');
		git(fork, ['commit', '-qam', 'fix']);
		git(fork, ['config', 'diff.renames', 'not-a-valid-value']);

		const r = run(fork, []);
		expect(r.status).not.toBe(0);
		expect(r.stdout).not.toContain('Nothing to report upstream');
	});

	itWithPosixPaths('escapes terminal controls in the human report', () => {
		const escape = String.fromCharCode(27);
		const path = `shared/${escape}[2J${escape}[HNothing to report upstream.ts`;
		write(upstream, path, 'export const safe = 1;\n');
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add controlled path']);
		git(fork, ['fetch', '-q', 'upstream']);
		write(fork, path, 'export const safe = 1;\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add controlled path']);
		markBase(fork);
		write(fork, path, 'export const safe = 2;\n');
		git(fork, ['commit', '-qam', 'edit controlled path']);

		const r = run(fork, ['--fetch', path]);
		expect(r.status).toBe(0);
		expect(r.stdout).not.toContain(escape);
		expect(r.stdout).toContain('\\u001b[2J\\u001b[HNothing to report upstream.ts');
	});

	itWithPosixPaths('escapes bidirectional controls in human and JSON reports', () => {
		const bidi = String.fromCharCode(0x202e);
		const path = `shared/${bidi}reordered.ts`;
		write(upstream, path, 'export const bidiSafe = 1;\n');
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add bidi path']);
		git(fork, ['fetch', '-q', 'upstream']);
		write(fork, path, 'export const bidiSafe = 1;\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add bidi path']);
		markBase(fork);
		write(fork, path, 'export const bidiSafe = 2;\n');
		git(fork, ['commit', '-qam', 'edit bidi path']);

		const human = run(fork, ['--fetch', path]);
		expect(human.status, human.stderr).toBe(0);
		expect(human.stdout).not.toContain(bidi);
		expect(human.stdout).toContain('\\u202ereordered.ts');

		const json = run(fork, ['--fetch', '--json', path]);
		expect(json.status, json.stderr).toBe(0);
		expect(json.stdout).not.toContain(bidi);
		expect(json.stdout).toContain('\\u202ereordered.ts');
		const parsed = JSON.parse(json.stdout) as { verdicts: Array<{ path: string }> };
		expect(parsed.verdicts[0]?.path).toBe(path);
	});

	itWithPosixPaths('escapes C1 and Unicode line controls in human and JSON reports', () => {
		const csi = String.fromCharCode(0x009b);
		const lineSeparator = String.fromCharCode(0x2028);
		const path = `shared/${csi}31m${lineSeparator}Nothing to report upstream.ts`;
		write(upstream, path, 'export const controlSafe = 1;\n');
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add controlled path']);
		git(fork, ['fetch', '-q', 'upstream']);
		write(fork, path, 'export const controlSafe = 1;\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add controlled path']);
		markBase(fork);
		write(fork, path, 'export const controlSafe = 2;\n');
		git(fork, ['commit', '-qam', 'edit controlled path']);

		const human = run(fork, ['--fetch', path]);
		expect(human.status, human.stderr).toBe(0);
		expect(human.stdout).not.toContain(csi);
		expect(human.stdout).not.toContain(lineSeparator);
		expect(human.stdout).toContain('\\u009b31m\\u2028Nothing to report upstream.ts');

		const json = run(fork, ['--fetch', '--json', path]);
		expect(json.status, json.stderr).toBe(0);
		expect(json.stdout).not.toContain(csi);
		expect(json.stdout).not.toContain(lineSeparator);
		expect(json.stdout).toContain('\\u009b31m\\u2028Nothing to report upstream.ts');
	});

	it('renders a human report that marks what to read', () => {
		// Every other assertion reads --json, so a renderer that dropped every
		// marker, or printed "Nothing to report upstream" unconditionally, would
		// leave the whole suite green while showing an agent the wrong answer.
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 42;\n');
		write(fork, 'product/only-here.ts', 'export const product = false;\n');
		git(fork, ['commit', '-qam', 'both']);

		const r = run(fork, ['--fetch']);
		expect(r.status).toBe(0);
		expect(r.stdout).toMatch(/>> pristine\s+shared\/pristine\.ts/);
		expect(r.stdout).not.toContain('product/only-here.ts');
		expect(r.stdout).toContain('1 of 2 changed files need a look');
		expect(r.stdout).not.toContain('Nothing to report upstream');
	});

	it('says plainly when nothing template-derived changed', () => {
		write(fork, 'product/only-here.ts', 'export const product = false;\n');
		git(fork, ['commit', '-qam', 'fork only']);

		const r = run(fork, ['--fetch']);
		expect(r.status).toBe(0);
		expect(r.stdout).toContain('Nothing to report upstream');
	});

	it('accepts an explicit path in any form git understands', () => {
		// `./x`, a directory and a redundant separator all miss an exact lookup
		// against the upstream file set, and a miss reads as fork-only.
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 43;\n');
		git(fork, ['commit', '-qam', 'fix']);

		for (const form of ['./shared/pristine.ts', 'shared//pristine.ts', 'shared']) {
			const v = verdicts(fork, [form]);
			expect(v['shared/pristine.ts'], `form ${form}`).toBe('pristine');
		}
	});

	it('refuses explicit paths when the parent marker changed in the commit range', () => {
		const marker = JSON.parse(readFileSync(join(fork, '.upstream-sync.json'), 'utf8')) as Record<
			string,
			unknown
		>;
		write(fork, '.upstream-sync.json', JSON.stringify({ ...marker, detectorFixture: true }));
		git(fork, ['commit', '-qam', 'change parent marker']);

		const r = run(fork, ['--fetch', '--json', 'shared/pristine.ts']);

		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/\.upstream-sync\.json changed in the selected commit range/);
	});

	itWithGitWrapper('deduplicates explicit pathspecs before enumeration', () => {
		const enumerationLog = join(tmp, 'path-enumeration.log');
		const r = run(fork, ['--fetch', '--json', 'shared', 'shared', './shared'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			PATH_ENUMERATION_LOG: enumerationLog
		});
		expect(r.status, r.stderr).toBe(0);
		expect(readFileSync(enumerationLog, 'utf8').trim().split('\n')).toHaveLength(3);
	});

	it('bounds aggregate explicit path expansion', () => {
		const r = run(fork, ['--fetch', '--json', '--all', '.'], {
			NODE_ENV: 'test',
			UPSTREAM_REPORT_TEST_PATH_LIMIT: '1'
		});
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/matched more than 1 files/);
	});

	it('bounds aggregate automatic path discovery', () => {
		write(fork, 'product/automatic-one.ts', 'automaticOne();\n');
		write(fork, 'product/automatic-two.ts', 'automaticTwo();\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add automatic paths']);

		const r = run(fork, ['--json'], {
			NODE_ENV: 'test',
			UPSTREAM_REPORT_TEST_PATH_LIMIT: '1'
		});

		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/Automatic discovery found more than 1 changed paths/);
	});

	it('refuses staged marker bytes that differ from the working tree', () => {
		const stagedParent = join(tmp, 'staged-parent');
		mkdirSync(stagedParent);
		init(stagedParent);
		write(stagedParent, 'inherited.ts', 'stagedParentInheritance();\n');
		git(stagedParent, ['add', '-A']);
		git(stagedParent, ['commit', '-qm', 'add inherited file']);

		write(fork, '.upstream-sync.json', JSON.stringify({ upstreamUrl: stagedParent }));
		write(fork, 'inherited.ts', 'stagedParentInheritance();\n');
		git(fork, ['add', '.upstream-sync.json', 'inherited.ts']);
		write(fork, '.upstream-sync.json', JSON.stringify({ upstreamUrl: upstream }));

		const r = run(fork, ['--fetch', '--json', '--all', 'inherited.ts']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/must be committed and clean/);
	});

	it('refuses an ignored untracked upstream marker', () => {
		git(fork, ['rm', '-q', '.upstream-sync.json']);
		git(fork, ['commit', '-qm', 'remove upstream marker']);
		writeFileSync(join(fork, '.git', 'info', 'exclude'), '.upstream-sync.json\n');
		write(fork, '.upstream-sync.json', JSON.stringify({ upstreamUrl: upstream }));

		const r = run(fork, ['--fetch', '--json', 'shared/pristine.ts']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/exists but is not tracked/);
	});

	it('refuses an oversized upstream marker before allocating its bytes', () => {
		write(fork, '.upstream-sync.json', `${' '.repeat(1024 * 1024)}x`);
		git(fork, ['commit', '-qam', 'oversize marker']);

		const r = run(fork, ['--json']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/input limit/);
	});

	it('refuses a marker that cannot be parsed instead of assuming the default template', () => {
		// A fork of a fork names its own parent here. Falling back silently would
		// classify it against the wrong repository, and with --fetch would pull it.
		write(fork, '.upstream-sync.json', '{ not valid json');
		git(fork, ['commit', '-qam', 'break marker']);

		const r = run(fork, ['shared/pristine.ts']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/not valid JSON/);
	});

	it('escapes controls copied into a malformed-marker diagnostic', () => {
		const escape = String.fromCharCode(27);
		write(fork, '.upstream-sync.json', `{"upstreamUrl":"ok"}${escape}[31m`);
		git(fork, ['commit', '-qam', 'add malformed marker control']);

		const r = run(fork, ['shared/pristine.ts']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).not.toContain(escape);
		expect(r.stderr).toContain('\\u001b');
	});

	itWithPosixPaths('refuses a dangling upstream marker symlink', () => {
		rmSync(join(fork, '.upstream-sync.json'));
		symlinkSync('../missing-upstream-marker.json', join(fork, '.upstream-sync.json'));

		const r = run(fork, ['--fetch', '--json']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/must be a regular file/);
	});

	itWithPosixPaths('refuses a clean tracked upstream marker symlink', () => {
		const target = join(tmp, 'external-upstream-marker.json');
		writeFileSync(target, JSON.stringify({ upstreamUrl: upstream }));
		rmSync(join(fork, '.upstream-sync.json'));
		symlinkSync(target, join(fork, '.upstream-sync.json'));
		git(fork, ['add', '.upstream-sync.json']);
		git(fork, ['commit', '-qm', 'track marker symlink']);

		const r = run(fork, ['--fetch', '--json', 'shared/pristine.ts']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/must be a regular file/);
	});

	it.each([
		['null URL', { upstreamUrl: null }],
		['false URL', { upstreamUrl: false }],
		['short fork point', { upstreamUrl: upstream, forkPoint: 'abc' }],
		['numeric last synced', { upstreamUrl: upstream, lastSynced: 42 }],
		['array root', []]
	])('refuses a marker with %s', (_name, marker) => {
		write(fork, '.upstream-sync.json', JSON.stringify(marker));

		const r = run(fork, ['--fetch', 'shared/pristine.ts']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(
			/must (?:contain a JSON object|be a non-empty string|be full commit SHAs)/
		);
	});

	it('redacts a failed fetch before Git stderr reaches the caller', () => {
		const secret = 'DUMMY_FETCH_QUERY_SECRET';
		const url = `http://127.0.0.1:1/repo.git?token=${secret}`;
		write(fork, '.upstream-sync.json', JSON.stringify({ upstreamUrl: url }));
		git(fork, ['commit', '-qam', 'set unreachable parent']);
		git(fork, ['remote', 'set-url', 'upstream', url]);

		const r = run(fork, ['--fetch', '--json']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).not.toContain(secret);
		expect(r.stderr).toContain('repo.git?***');
	});

	itWithGitWrapper('disables maintenance in the private transport repository', () => {
		const wrapper = installGitWrapper(tmp);
		const fetchLog = join(tmp, 'fetch-command.log');
		const r = run(fork, ['--fetch', '--json', 'shared/pristine.ts'], {
			PATH: `${wrapper}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			FETCH_COMMAND_LOG: fetchLog
		});
		expect(r.status, r.stderr).toBe(0);
		const commands = readFileSync(fetchLog, 'utf8');
		expect(commands).toContain(' --no-auto-maintenance ');
	});

	itWithGitWrapper('copies credential helpers into the private transport config', () => {
		const helper = '!credential-probe "quoted" C:\\tools';
		git(fork, ['config', '--local', 'credential.helper', helper]);
		const wrapper = installGitWrapper(tmp);
		const credentialLog = join(tmp, 'transport-credential.log');
		const r = run(fork, ['--json', 'shared/pristine.ts'], {
			PATH: `${wrapper}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			TRANSPORT_CREDENTIAL_LOG: credentialLog
		});
		expect(r.status, r.stderr).toBe(0);
		expect(readFileSync(credentialLog, 'utf8').trim()).toBe(helper);
	});

	itWithGitWrapper(
		'copies URL-scoped HTTP authentication into the private transport config',
		() => {
			git(fork, [
				'config',
				'--local',
				`http.${upstream}.extraHeader`,
				'Authorization: Bearer DUMMY_SCOPED_HEADER'
			]);
			const wrapper = installGitWrapper(tmp);
			const httpLog = join(tmp, 'transport-http.log');
			const r = run(fork, ['--json', 'shared/pristine.ts'], {
				PATH: `${wrapper}:${process.env.PATH ?? ''}`,
				REAL_GIT: realGitPath(),
				TRANSPORT_HTTP_LOG: httpLog
			});
			expect(r.status, r.stderr).toBe(0);
			expect(readFileSync(httpLog, 'utf8')).toContain('Authorization: Bearer DUMMY_SCOPED_HEADER');
		}
	);

	itWithGitWrapper('does not copy unscoped HTTP authentication to a marker-selected host', () => {
		git(fork, ['config', '--local', 'http.extraHeader', 'Authorization: Bearer DUMMY_HEADER']);
		const wrapper = installGitWrapper(tmp);
		const httpLog = join(tmp, 'transport-unscoped-http.log');
		const r = run(fork, ['--json', 'shared/pristine.ts'], {
			PATH: `${wrapper}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			TRANSPORT_UNSCOPED_HTTP_LOG: httpLog
		});
		expect(r.status, r.stderr).toBe(0);
		expect(readFileSync(httpLog, 'utf8')).toBe('');
	});

	it('keeps copied authentication values out of child-process arguments', () => {
		const source = readFileSync(SCRIPT, 'utf8');
		const start = source.indexOf('function copyTransportAuthentication(');
		const end = source.indexOf('// Enough for a whole repository', start);
		const copy = source.slice(start, end);
		expect(copy).toContain('appendTransportConfig(');
		expect(copy).not.toContain('execFileSync(');
		expect(source).toContain('chmodSync(transportConfigPath, 0o600)');
	});

	itWithGitWrapper('keeps remote URLs out of detector Git arguments', () => {
		const secret = 'DUMMY_REMOTE_ARG_SECRET';
		const secretUpstream = join(tmp, `template?token=${secret}`);
		git(tmp, ['clone', '-q', upstream, secretUpstream]);
		const marker = JSON.parse(readFileSync(join(fork, '.upstream-sync.json'), 'utf8')) as Record<
			string,
			unknown
		>;
		write(fork, '.upstream-sync.json', JSON.stringify({ ...marker, upstreamUrl: secretUpstream }));
		git(fork, ['commit', '-qam', 'set private parent path']);
		git(fork, ['remote', 'set-url', 'upstream', secretUpstream]);
		const seen = join(tmp, 'remote-secret-in-argv');

		const r = run(fork, ['--fetch', '--json'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			CHILD_ARG_SECRET: secret,
			CHILD_ARG_MARKER: seen
		});

		expect(r.status, r.stderr).toBe(0);
		expect(existsSync(seen)).toBe(false);
	});

	it('fetches through a private SHA-256 transport repository', () => {
		const shaUpstream = join(tmp, 'sha256-template');
		mkdirSync(shaUpstream);
		init(shaUpstream, 'sha256');
		write(shaUpstream, 'shared/template.ts', 'export const template = 1;\n');
		git(shaUpstream, ['add', '-A']);
		git(shaUpstream, ['commit', '-qm', 'template']);
		const forkPoint = git(shaUpstream, ['rev-parse', 'HEAD']);

		const shaFork = join(tmp, 'sha256-fork');
		mkdirSync(shaFork);
		init(shaFork, 'sha256');
		write(shaFork, 'shared/template.ts', 'export const template = 1;\n');
		write(
			shaFork,
			'.upstream-sync.json',
			JSON.stringify({ upstreamUrl: shaUpstream, forkPoint, lastSynced: forkPoint })
		);
		git(shaFork, ['add', '-A']);
		git(shaFork, ['commit', '-qm', 'fork base']);
		const shaOrigin = join(tmp, 'sha256-origin.git');
		mkdirSync(shaOrigin);
		git(shaOrigin, ['init', '--bare', '-q', '--object-format=sha256']);
		git(shaFork, ['remote', 'add', 'origin', shaOrigin]);
		git(shaFork, ['remote', 'add', 'upstream', shaUpstream]);
		git(shaFork, ['fetch', '-q', 'upstream']);
		markBase(shaFork);
		write(shaFork, 'shared/template.ts', 'export const template = 2;\n');
		git(shaFork, ['commit', '-qam', 'fix template path']);

		const r = run(shaFork, ['--fetch', '--json', 'shared/template.ts']);
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string }>;
		};
		expect(parsed.verdicts[0]?.relevance).toBe('pristine');
	});

	it('refreshes a stale ref when --fetch is given', () => {
		// The orphan-ref error suggests --fetch, so --fetch must actually fetch.
		// It used to be skipped whenever a ref already existed, leaving the stale
		// tree in place and every verdict computed from it unchanged.
		write(upstream, 'shared/newly-added-upstream.ts', 'export const fresh = 1;\n');
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'new upstream file']);
		write(fork, 'shared/newly-added-upstream.ts', 'export const fresh = 1;\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'same file here']);

		// A no-fetch run can use the old tree to find ties, but it cannot use an
		// absent path to rule one out. Only this run's fetch earns fork-only.
		const stale = git(fork, ['rev-parse', 'refs/remotes/upstream/main']);
		const before = run(fork, ['--json']);
		expect(before.status).toBe(0);
		const beforeVerdicts = JSON.parse(before.stdout) as {
			verdicts: Array<{ path: string; relevance: string }>;
		};
		expect(
			beforeVerdicts.verdicts.find((v) => v.path === 'shared/newly-added-upstream.ts')?.relevance
		).toBe('unmeasured');
		expect(verdicts(fork, ['--fetch'])['shared/newly-added-upstream.ts']).not.toBe('fork-only');
		// The verdict has to change because the copy advanced. Special-casing an
		// absent path whenever --fetch is present would satisfy the line above.
		expect(git(fork, ['rev-parse', 'refs/remotes/upstream/main'])).not.toBe(stale);
	});

	it('reports a deleted template file, in any spelling of its path', () => {
		// Deleting template code is worth reporting, and the deletion branch of the
		// path handling used to keep the caller's raw spelling: `./shared/x.ts`
		// then missed the exact upstream lookup and came back fork-only.
		git(fork, ['rm', '-q', 'shared/pristine.ts']);
		git(fork, ['commit', '-qm', 'delete template file']);

		for (const form of ['shared/pristine.ts', './shared/pristine.ts']) {
			const v = verdicts(fork, [form]);
			expect(v['shared/pristine.ts'], `form ${form}`).toBe('pristine');
		}
	});

	it('calls a case-only difference ambiguous instead of fork-only', () => {
		// The template has `shared/Config.ts`; this fork writes `shared/config.ts`.
		// macOS and Windows treat those as one file and git treats them as two, so
		// an exact-lookup miss is not evidence the template lacks the file, and
		// answering fork-only would be a silent negative on the same file.
		write(fork, 'shared/config.ts', 'export const config = 2;\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'case variant']);

		const v = verdicts(fork, ['shared/config.ts']);
		expect(v['shared/config.ts']).toBe('unmeasured');
	});

	it('does not call a file fork-only when upstream renamed it away', () => {
		// The path is gone upstream and the content is not. A fork that still
		// carries the template's spelling and fixes a template bug in it would be
		// suppressed by an exact-path lookup, which is the silent negative this
		// whole file exists to prevent.
		git(upstream, ['mv', 'shared/pristine.ts', 'shared/renamed.ts']);
		git(upstream, ['commit', '-qm', 'rename upstream']);
		git(fork, ['fetch', '-q', 'upstream']);

		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 99;\n');
		git(fork, ['commit', '-qam', 'fix the old path']);

		const v = verdicts(fork, ['shared/pristine.ts']);
		expect(v['shared/pristine.ts']).toBe('unmeasured');
	});

	it('does not call a fork copy of template code fork-only', () => {
		// The fork copied an inherited file to a product path, then fixed an
		// inherited bug in the copy. `-M` finds renames and not copies, so only
		// the fork-specific destination is classified, and its path is absent
		// upstream.
		write(fork, 'product/copied.ts', 'export const a = 1;\nexport const b = 2;\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'copy template code']);
		markBase(fork);

		write(fork, 'product/copied.ts', 'export const a = 1;\nexport const b = 99;\n');
		git(fork, ['commit', '-qam', 'fix the copy']);

		const v = verdicts(fork, ['product/copied.ts']);
		expect(v['product/copied.ts']).toBe('unmeasured');
	});

	itWithPosixPaths('treats pathspec-looking explicit arguments and diffs literally', () => {
		const path = ':(literal)shared.ts';
		write(upstream, path, 'export const inherited = 1;\n');
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add literal path']);
		git(fork, ['fetch', '-q', 'upstream']);
		write(fork, path, 'export const inherited = 1;\nexport const forkOnly = 1;\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add fork version']);
		markBase(fork);
		write(fork, path, 'export const forkOnly = 1;\n');
		git(fork, ['commit', '-qam', 'remove inherited line']);

		const scored = verdictsWithScore(fork, [path]);
		expect(scored[path]?.relevance).toBe('diverged');
		expect(scored[path]?.overlap).toBe(1);
	});

	it('refuses when one explicit path matches and another does not', () => {
		// A valid neighbour used to cover a typo: git drops the unmatched argument
		// without a word, the combined list is still non-empty, and the run exits
		// zero having never looked at the file the caller meant.
		const r = run(fork, ['product/only-here.ts', 'shared/pristnie.ts']);
		expect(r.status).not.toBe(0);
		expect(r.stdout).not.toContain('Nothing to report upstream');
		expect(r.stderr).toContain('shared/pristnie.ts');
	});

	it('sees a submodule change through per-submodule ignore=all', () => {
		// Inherited config that suppresses a whole class of change is the same
		// failure as a broken diff: all three collectors drop the path and the run
		// exits zero. `update-index --cacheinfo` builds the gitlink without a real
		// submodule checkout, which is enough for git to diff it.
		const first = git(upstream, ['rev-parse', 'HEAD']);
		for (const repo of [upstream, fork]) {
			write(
				repo,
				'.gitmodules',
				'[submodule "dep"]\n\tpath = vendor/dep\n\turl = ../dep.git\n\tignore = all\n'
			);
			git(repo, ['update-index', '--add', `--cacheinfo`, `160000,${first},vendor/dep`]);
			git(repo, ['commit', '-qm', 'add gitlink']);
		}
		git(fork, ['fetch', '-q', 'upstream']);
		markBase(fork);
		git(fork, ['config', 'submodule.dep.ignore', 'all']);

		const second = git(fork, ['rev-parse', 'HEAD']);
		git(fork, ['update-index', `--cacheinfo`, `160000,${second},vendor/dep`]);
		git(fork, ['commit', '-qm', 'move the gitlink']);

		const v = verdicts(fork);
		expect(Object.keys(v)).toContain('vendor/dep');
	});

	it('keeps a dirty unchanged gitlink unmeasured', () => {
		const dependency = join(tmp, 'gitlink-dependency');
		mkdirSync(dependency);
		init(dependency);
		write(dependency, 'tracked.txt', 'clean dependency\n');
		git(dependency, ['add', '-A']);
		git(dependency, ['commit', '-qm', 'add dependency file']);
		const dependencySha = git(dependency, ['rev-parse', 'HEAD']);

		for (const repo of [upstream, fork]) {
			write(
				repo,
				'.gitmodules',
				`[submodule "dirty"]\n\tpath = vendor/dirty\n\turl = ${dependency}\n`
			);
			git(repo, ['update-index', '--add', '--cacheinfo', `160000,${dependencySha},vendor/dirty`]);
			git(repo, ['commit', '-qm', 'add dirty gitlink']);
		}
		git(fork, ['fetch', '-q', 'upstream']);
		markBase(fork);
		mkdirSync(join(fork, 'vendor'), { recursive: true });
		git(fork, ['-c', 'protocol.file.allow=always', 'clone', '-q', dependency, 'vendor/dirty']);
		write(fork, 'vendor/dirty/tracked.txt', 'dirty dependency\n');

		const r = run(fork, ['--fetch', '--json', 'vendor/dirty']);
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		expect(parsed.verdicts[0]?.relevance).toBe('unmeasured');
		expect(parsed.verdicts[0]?.note).toMatch(/gitlink|not a regular file/);
	});

	itWithGitWrapper('batches current upstream blob reads across changed paths', () => {
		const paths = Array.from({ length: 3 }, (_, index) => `shared/batched-${index}.ts`);
		for (const [index, path] of paths.entries()) {
			write(upstream, path, `export const templateBatch${index} = true;\n`);
			write(fork, path, `export const forkBatch${index} = true;\n`);
		}
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add batched upstream paths']);
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add divergent batched paths']);
		git(fork, ['fetch', '-q', 'upstream']);
		markBase(fork);
		for (const [index, path] of paths.entries()) {
			write(fork, path, `export const forkBatch${index} = false;\n`);
		}
		git(fork, ['commit', '-qam', 'edit batched paths']);
		const processLog = join(tmp, 'cat-file-checks.log');

		const r = run(fork, ['--fetch', '--json', ...paths], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			CAT_FILE_CHECK_LOG: processLog
		});
		expect(r.status, r.stderr).toBe(0);
		expect(readFileSync(processLog, 'utf8').trim().split('\n')).toHaveLength(2);
	});

	it('keeps trailing whitespace significant in local repository paths', () => {
		const spacedUpstream = `${upstream} `;
		git(tmp, ['clone', '-q', upstream, spacedUpstream]);
		git(spacedUpstream, ['config', 'user.email', 'test@example.com']);
		git(spacedUpstream, ['config', 'user.name', 'Test']);
		write(spacedUpstream, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 50;\n');
		git(spacedUpstream, ['commit', '-qam', 'change spaced parent']);
		git(fork, ['remote', 'set-url', 'upstream', spacedUpstream]);
		git(fork, ['fetch', '-q', 'upstream']);
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 50;\n');
		git(fork, ['commit', '-qam', 'match spaced parent']);
		markBase(fork);
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 51;\n');
		git(fork, ['commit', '-qam', 'edit shared path']);

		const r = run(fork, ['--json', 'shared/pristine.ts']);

		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/different repository/);
	});

	it('keeps .git significant in local repository paths', () => {
		const decoy = `${upstream}.git`;
		mkdirSync(decoy);
		init(decoy);
		write(decoy, 'decoy.ts', 'export const decoy = true;\n');
		git(decoy, ['add', '-A']);
		git(decoy, ['commit', '-qm', 'decoy']);
		git(fork, ['remote', 'set-url', 'upstream', decoy]);

		const r = run(fork, ['--fetch', '--json', 'shared/pristine.ts']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/different repository/);
	});

	it('keeps non-git SSH identities distinct', () => {
		write(
			fork,
			'.upstream-sync.json',
			JSON.stringify({ upstreamUrl: 'ssh://alice@example.invalid/~/template.git' })
		);
		git(fork, ['commit', '-qam', 'set SSH parent']);
		git(fork, ['remote', 'set-url', 'upstream', 'ssh://bob@example.invalid/~/template.git']);

		const r = run(fork, []);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/different repository/);
	});

	it('escapes controls in remote diagnostics', () => {
		const escape = String.fromCharCode(27);
		const upstreamUrl = `https://example.invalid/${escape}[2Jtemplate.git`;
		write(fork, '.upstream-sync.json', JSON.stringify({ upstreamUrl }));
		git(fork, ['commit', '-qam', 'set control-character parent']);
		git(fork, ['remote', 'set-url', 'upstream', 'https://example.invalid/other.git']);

		const r = run(fork, []);
		expect(r.status).not.toBe(0);
		expect(r.stderr).not.toContain(escape);
		expect(r.stderr).toContain('\\u001b[2J');
	});

	it('keeps a credential out of the remote-mismatch diagnostic', () => {
		// `git remote get-url` returns the URL exactly as configured, tokens and
		// all, and this diagnostic is the one place it reaches a terminal, an
		// agent transcript or a CI log.
		git(fork, [
			'remote',
			'set-url',
			'upstream',
			'https://user@example.com:DUMMY_DOUBLE_AT_SECRET@github.com/owner/x.git'
		]);

		const r = run(fork, []);
		expect(r.status).not.toBe(0);
		expect(r.stderr).not.toContain('DUMMY_DOUBLE_AT_SECRET');
		expect(r.stderr).not.toContain('user@example.com');
		expect(r.stderr).toContain('***@github.com');
	});

	it('redacts scheme userinfo that contains whitespace', () => {
		const remote = 'https://user\nDUMMY_MULTILINE_USERINFO@example.invalid/repo.git';
		git(fork, ['remote', 'set-url', 'upstream', remote]);

		const r = run(fork, []);
		expect(r.status).not.toBe(0);
		expect(r.stderr).not.toContain('DUMMY_MULTILINE_USERINFO');
		expect(r.stderr).not.toContain('user');
		expect(r.stderr).toContain('https://***@example.invalid');
	});

	it('redacts SCP-style remote userinfo', () => {
		git(fork, ['remote', 'set-url', 'upstream', 'DUMMY_SCP_SECRET@example.invalid:owner/repo.git']);

		const r = run(fork, ['shared/pristine.ts']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).not.toContain('DUMMY_SCP_SECRET');
		expect(r.stderr).toContain('***@example.invalid');
	});

	it('redacts credentials carried in a remote query string', () => {
		const remote = 'https://example.invalid/repo.git?access_token=DUMMY_QUERY_SECRET';
		write(fork, '.upstream-sync.json', JSON.stringify({ upstreamUrl: remote }));
		git(fork, ['commit', '-qam', 'set query-string parent']);
		git(fork, ['remote', 'set-url', 'upstream', remote]);

		const r = run(fork, ['--json']);
		expect(r.status).toBe(0);
		expect(r.stdout).not.toContain('DUMMY_QUERY_SECRET');
		expect(r.stdout).toContain('repo.git?***');
	});

	it('redacts credentials carried in a remote fragment', () => {
		const remote = 'https://example.invalid/repo.git#access_token=DUMMY_FRAGMENT_SECRET';
		write(fork, '.upstream-sync.json', JSON.stringify({ upstreamUrl: remote }));
		git(fork, ['commit', '-qam', 'set fragment remote']);
		git(fork, ['remote', 'set-url', 'upstream', remote]);

		const r = run(fork, ['--json']);
		expect(r.status).toBe(0);
		expect(r.stdout).not.toContain('DUMMY_FRAGMENT_SECRET');
		expect(r.stdout).toContain('repo.git#***');
	});

	it('redacts a multiline remote query string', () => {
		const remote =
			'https://example.invalid/repo.git?access_token=DUMMY_MULTILINE_SECRET\ncontinued=1';
		write(fork, '.upstream-sync.json', JSON.stringify({ upstreamUrl: remote }));
		git(fork, ['commit', '-qam', 'set multiline parent']);

		const r = run(fork, []);
		expect(r.status).not.toBe(0);
		expect(r.stderr).not.toContain('DUMMY_MULTILINE_SECRET');
		expect(r.stderr).toContain('repo.git?***');
	});

	it('pins full stat checks when repository config weakens them', async () => {
		const path = join(fork, 'shared/pristine.ts');
		const cachedTime = new Date(Math.floor((Date.now() - 60_000) / 1_000) * 1_000);
		utimesSync(path, cachedTime, cachedTime);
		git(fork, ['update-index', '--refresh']);
		await new Promise((resolve) => setTimeout(resolve, 1_100));
		writeFileSync(path, 'export const a = 1;\nexport const b = 3;\n');
		utimesSync(path, cachedTime, cachedTime);
		git(fork, ['config', 'core.trustctime', 'false']);
		git(fork, ['config', 'core.checkStat', 'minimal']);

		const r = run(fork, ['--fetch', '--json']);
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string }>;
		};
		expect(parsed.verdicts.find((entry) => entry.path === 'shared/pristine.ts')?.relevance).toBe(
			'pristine'
		);
	});

	itWithGitWrapper('rejects partial output from a failed captured diff', () => {
		write(upstream, 'shared/captured-failure.ts', 'upstreamOne();\nupstreamTwo();\n');
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add captured diff fixture']);
		git(fork, ['fetch', '-q', 'upstream']);
		write(fork, 'shared/captured-failure.ts', 'forkBaseOne();\nforkBaseTwo();\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add diverged captured path']);
		markBase(fork);
		write(fork, 'shared/captured-failure.ts', 'forkAfterOne();\nforkAfterTwo();\n');
		git(fork, ['commit', '-qam', 'rewrite diverged captured path']);
		const marker = join(tmp, 'captured-diff-failed');

		const r = run(fork, ['--fetch', '--json', 'shared/captured-failure.ts'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			FAIL_CAPTURED_DIFF_MARKER: marker
		});
		expect(existsSync(marker)).toBe(true);
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'shared/captured-failure.ts');
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/diff command failed before completing/);
	});

	itWithGitWrapper('times out a stalled captured diff', () => {
		write(upstream, 'shared/captured-timeout.ts', 'upstreamOne();\nupstreamTwo();\n');
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add captured timeout fixture']);
		git(fork, ['fetch', '-q', 'upstream']);
		write(fork, 'shared/captured-timeout.ts', 'forkBaseOne();\nforkBaseTwo();\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add diverged timeout path']);
		markBase(fork);
		write(fork, 'shared/captured-timeout.ts', 'forkAfterOne();\nforkAfterTwo();\n');
		git(fork, ['commit', '-qam', 'rewrite diverged timeout path']);

		const r = run(fork, ['--fetch', '--json', 'shared/captured-timeout.ts'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			NODE_ENV: 'test',
			SLOW_CAPTURED_DIFF: '1',
			UPSTREAM_REPORT_TEST_DIFF_TIMEOUT_MS: '50'
		});

		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'shared/captured-timeout.ts');
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/diff command failed before completing/);
	});

	it("leaves the caller's index alone when a stat-only change is pending", () => {
		// A worktree diff refreshes the index when the stat data moved and the
		// content did not, which takes index.lock in the caller's repository.
		// Measured on git 2.55: GIT_OPTIONAL_LOCKS=0 stops that for `git status`
		// and not for `git diff`, so the run reads through a private copy.
		const indexPath = join(fork, '.git', 'index');
		// A settling run first, so the index carries current stat data and the
		// only mismatch left is the one this test creates.
		run(fork, ['--json']);
		const before = statSync(indexPath).mtimeMs;
		// Same bytes, stat data moved well clear of the cached values. Rewriting
		// the file is not enough on its own: within the same second git reads the
		// entry as racily clean and may leave the index alone, which passes this
		// test for the wrong reason.
		const stale = new Date(Date.now() - 60_000);
		utimesSync(join(fork, 'shared/pristine.ts'), stale, stale);
		const r = run(fork, ['--json']);

		expect(r.status).toBe(0);
		expect(statSync(indexPath).mtimeMs).toBe(before);
	});

	itWithPosixPaths('matches a path holding a tab against the upstream tree', () => {
		// `ls-tree` without `-z` quotes a path containing a tab, a newline or a
		// backslash even under core.quotePath=false, while the changed-file
		// collectors return the raw bytes. The two spellings miss each other and
		// the file classifies fork-only.
		const tabbed = 'shared/ta\tb.ts';
		for (const repo of [upstream, fork]) {
			write(repo, tabbed, 'export const t = 1;\n');
			git(repo, ['add', '-A']);
			git(repo, ['commit', '-qm', 'tabbed path']);
		}
		git(fork, ['fetch', '-q', 'upstream']);
		markBase(fork);

		write(fork, tabbed, 'export const t = 99;\n');
		git(fork, ['commit', '-qam', 'edit the tabbed path']);

		const v = verdicts(fork);
		expect(v[tabbed]).toBe('pristine');
	});

	it('parses hunks when repository config forces color', () => {
		git(fork, ['config', 'color.ui', 'always']);
		write(
			fork,
			'shared/rewritten.ts',
			'export const changed = 99;\nexport const template2 = 2;\nexport const template3 = 3;\nexport const template4 = 4;\nexport const template5 = 5;\nexport const template6 = 6;\nexport const template7 = 7;\nexport const template8 = 8;\nexport const forkOnly1 = 1;\nexport const forkOnly2 = 2;\nexport const forkOnly3 = 3;\nexport const forkOnly4 = 4;\nexport const forkOnly5 = 5;\nexport const forkOnly6 = 6;\nexport const forkOnly7 = 7;\nexport const forkOnly8 = 8;\n'
		);
		git(fork, ['commit', '-qam', 'edit template line']);

		expect(verdictsWithScore(fork)['shared/rewritten.ts']?.overlap).toBe(1);
	});

	it('scores a tracked glob-looking filename literally', () => {
		const path = 'shared/[ab].ts';
		write(upstream, path, 'export const inherited = 1;\n');
		write(upstream, 'shared/a.ts', 'export const neighbor = 1;\n');
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add glob-looking path']);
		write(fork, path, 'export const inherited = 1;\nexport const forkOnly = 1;\n');
		write(fork, 'shared/a.ts', 'export const neighbor = 1;\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add fork versions']);
		git(fork, ['fetch', '-q', 'upstream']);
		markBase(fork);
		write(fork, path, 'export const forkOnly = 1;\n');
		git(fork, ['commit', '-qam', 'remove inherited line']);

		const scored = verdictsWithScore(fork, [path]);
		expect(scored[path]?.relevance).toBe('diverged');
		expect(scored[path]?.overlap).toBe(1);
	});

	it('prints the highest-scoring shared file first', () => {
		// The skill tells the reader to start at the top. Paths arrive
		// alphabetised, so without a rank the 0% file sits above the 100% one.
		// Both files are diverged at the base; they differ in where the change
		// landed. `aaa` replaces lines this fork added, `zzz` replaces template
		// lines that are still upstream.
		write(upstream, 'shared/aaa.ts', 'export const up1 = 1;\nexport const up2 = 2;\n');
		write(
			upstream,
			'shared/zzz.ts',
			'export const tpl1 = 1;\nexport const tpl2 = 2;\nexport const tpl3 = 3;\n'
		);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'two shared files']);
		git(fork, ['fetch', '-q', 'upstream']);

		write(
			fork,
			'shared/aaa.ts',
			'export const up1 = 1;\nexport const up2 = 2;\nexport const fork1 = 1;\nexport const fork2 = 2;\nexport const fork3 = 3;\n'
		);
		write(
			fork,
			'shared/zzz.ts',
			'export const tpl1 = 1;\nexport const tpl2 = 2;\nexport const tpl3 = 3;\nexport const fork9 = 9;\n'
		);
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'fork versions']);
		markBase(fork);

		// Removes only fork-added lines: nothing of what it replaced is upstream.
		write(fork, 'shared/aaa.ts', 'export const up1 = 1;\nexport const up2 = 2;\n');
		// Removes template lines that upstream still carries.
		write(fork, 'shared/zzz.ts', 'export const changed = 9;\nexport const fork9 = 9;\n');
		git(fork, ['commit', '-qam', 'edit both']);

		const scored = verdictsWithScore(fork);
		expect(scored['shared/aaa.ts']?.overlap).toBe(0);
		expect(scored['shared/zzz.ts']?.overlap).toBe(1);

		const r = run(fork, []);
		expect(r.status).toBe(0);
		const order = r.stdout
			.split('\n')
			.filter((l) => l.includes('diverged'))
			.map((l) => l.trim());
		expect(order.length).toBe(2);
		expect(order[0]).toContain('shared/zzz.ts');
		expect(order[1]).toContain('shared/aaa.ts');
	});

	it('reports the age of the local upstream copy on every run', () => {
		// A fork-only verdict from a copy that predates an upstream file is wrong
		// and invisible. The age is the only thing that lets a reader doubt it, so
		// it is not held back for a staleness threshold.
		const r = run(fork, []);
		expect(r.status).toBe(0);
		expect(r.stdout).toContain('Local upstream copy:');
	});

	it('does not call a relocated template file fork-only', () => {
		// The fork had already customised its copy, so blob identity finds
		// nothing, and upstream then renamed the file away. That file is the one
		// most likely to still carry a template bug, and an exact-path lookup
		// suppresses it.
		write(fork, 'shared/relocated.ts', 'export const t = 1;\nexport const forkOnly = 2;\n');
		write(upstream, 'shared/other/relocated.ts', 'export const t = 1;\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'customised copy']);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'upstream keeps it elsewhere']);
		git(fork, ['fetch', '-q', 'upstream']);
		markBase(fork);

		write(fork, 'shared/relocated.ts', 'export const t = 99;\nexport const forkOnly = 2;\n');
		git(fork, ['commit', '-qam', 'fix it here']);

		const v = verdicts(fork, ['shared/relocated.ts']);
		expect(v['shared/relocated.ts']).toBe('unmeasured');
	});

	it('keeps a name the template uses more than once out of the report', () => {
		// `types.ts` and `index.ts` sit in a dozen upstream directories. Matching
		// on those would flag most of this fork's own files and make the report
		// too noisy to read, which is the same as not running it.
		for (const dir of ['shared/one', 'shared/two']) {
			write(upstream, `${dir}/types.ts`, 'export type A = 1;\n');
		}
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'two files of one name']);
		git(fork, ['fetch', '-q', 'upstream']);

		write(fork, 'product/types.ts', 'export type P = 1;\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'a product file of that name']);

		const r = run(fork, ['--fetch', '--json', 'product/types.ts']);
		expect(r.status).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ relevance: string; note?: string }>;
		};
		expect(parsed.verdicts[0]?.relevance).toBe('unmeasured');
		expect(parsed.verdicts[0]?.note).toContain('design judgment');
	});

	it('does not call a file pristine when only its mode matches upstream', () => {
		// One blob is shared by a regular file and a symlink to that text, and by
		// an executable and a non-executable copy. Pristine claims the fork never
		// touched the file, which is wrong when it changed what the file is.
		git(fork, ['update-index', '--chmod=+x', 'shared/pristine.ts']);
		git(fork, ['commit', '-qm', 'make it executable']);
		markBase(fork);

		const v = verdicts(fork, ['shared/pristine.ts']);
		expect(v['shared/pristine.ts']).toBe('unmeasured');
	});

	itWithPosixPaths('refuses a filesystem where Git cannot verify file modes', () => {
		git(fork, ['config', 'core.fileMode', 'false']);

		const r = run(fork, ['--fetch', '--json']);

		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/filesystem does not preserve executable bits/);
	});

	it('measures the age of the copy from the fetch, not the tip commit', () => {
		// A template that committed yesterday and was fetched a month ago is a
		// month behind, and the tip's commit date says one day. Every path added
		// upstream in that month reads as fork-only.
		const old = '2026-01-02T03:04:05+00:00';
		const tip = git(fork, ['rev-parse', 'refs/remotes/upstream/main']);
		git(fork, ['update-ref', '-d', 'refs/remotes/upstream/main']);
		git(
			fork,
			['update-ref', '-m', 'fetch upstream: storing head', 'refs/remotes/upstream/main', tip],
			{
				GIT_COMMITTER_DATE: old
			}
		);

		const r = run(fork, ['--json']);
		expect(r.status).toBe(0);
		const parsed = JSON.parse(r.stdout) as { upstreamAgeDays: number; upstreamAgeFrom: string };
		expect(parsed.upstreamAgeFrom).toBe('fetch');
		// The fixture's tip was committed seconds ago; only the reflog is old.
		expect(parsed.upstreamAgeDays).toBeGreaterThan(30);

		const human = run(fork, []);
		expect(human.status, human.stderr).toBe(0);
		expect(human.stdout).toContain('bun run upstream:report -- --fetch');
		expect(human.stdout).not.toContain('Run `git fetch upstream`');
	});

	it('marks a successful no-op --fetch as fresh for this run', () => {
		const old = '2026-01-02T03:04:05+00:00';
		const tip = git(fork, ['rev-parse', 'refs/remotes/upstream/main']);
		git(fork, ['update-ref', '-d', 'refs/remotes/upstream/main']);
		git(
			fork,
			['update-ref', '-m', 'fetch upstream: storing head', 'refs/remotes/upstream/main', tip],
			{ GIT_COMMITTER_DATE: old }
		);

		const r = run(fork, ['--fetch', '--json']);
		expect(r.status, `script failed: ${r.stderr}`).toBe(0);
		const parsed = JSON.parse(r.stdout) as { upstreamAgeDays: number; upstreamAgeFrom: string };
		expect(parsed.upstreamAgeFrom).toBe('fetch');
		expect(parsed.upstreamAgeDays).toBe(0);

		const later = run(fork, ['--json']);
		expect(later.status, later.stderr).toBe(0);
		const laterParsed = JSON.parse(later.stdout) as {
			upstreamAgeDays: number;
			upstreamAgeFrom: string;
		};
		expect(laterParsed.upstreamAgeFrom).toBe('fetch');
		expect(laterParsed.upstreamAgeDays).toBe(0);
	});

	it('recognises a pull reflog entry as the fetch that refreshed the copy', () => {
		const old = '2026-01-02T03:04:05+00:00';
		const tip = git(fork, ['rev-parse', 'refs/remotes/upstream/main']);
		git(fork, ['update-ref', '-d', 'refs/remotes/upstream/main']);
		git(
			fork,
			['update-ref', '-m', 'pull upstream main: storing head', 'refs/remotes/upstream/main', tip],
			{ GIT_COMMITTER_DATE: old }
		);

		const r = run(fork, ['--json']);
		expect(r.status).toBe(0);
		const parsed = JSON.parse(r.stdout) as { upstreamAgeDays: number; upstreamAgeFrom: string };
		expect(parsed.upstreamAgeFrom).toBe('fetch');
		expect(parsed.upstreamAgeDays).toBeGreaterThan(30);
	});

	it('does not let a later non-fetch ref write pass for a fetch', () => {
		// A remote-tracking reflog records every write to the ref, not only
		// fetches: update-ref, a push that advanced it, a restore script. Reading
		// the newest entry and calling it a fetch reported a month-old copy as
		// fetched today, and a path upstream added in that month stays hidden as
		// fork-only with no freshness warning to contradict it.
		const old = '2026-01-02T03:04:05+00:00';
		const tip = git(fork, ['rev-parse', 'refs/remotes/upstream/main']);
		// The old fetch has to land on a different commit than the restore, or git
		// writes no reflog entry for the second write and the fixture silently
		// stops containing the case: update-ref to a value the ref already holds
		// is a no-op down to the log, which is how this guard first passed against
		// its own mutation.
		const elsewhere = git(fork, ['rev-parse', 'HEAD']);
		git(fork, ['update-ref', '-d', 'refs/remotes/upstream/main']);
		git(
			fork,
			['update-ref', '-m', 'fetch upstream: storing head', 'refs/remotes/upstream/main', elsewhere],
			{ GIT_COMMITTER_DATE: old }
		);
		// Today, something that is not a fetch moves the ref to where it belongs.
		git(fork, ['update-ref', '-m', 'restore stale ref', 'refs/remotes/upstream/main', tip]);

		const r = run(fork, ['--json']);
		expect(r.status).toBe(0);
		const parsed = JSON.parse(r.stdout) as { upstreamAgeDays: number; upstreamAgeFrom: string };
		expect(parsed.upstreamAgeFrom).toBe('tip commit');
		expect(parsed.upstreamAgeDays).toBeLessThan(2);
	});

	it('says so when the reflog holds no fetch at all', () => {
		// Falling back to the tip's commit date is fine; claiming it was a fetch
		// is not, because the reader calibrates how much to trust a clean report
		// on exactly that word.
		const tip = git(fork, ['rev-parse', 'refs/remotes/upstream/main']);
		git(fork, ['update-ref', '-d', 'refs/remotes/upstream/main']);
		git(fork, ['update-ref', '-m', 'restore stale ref', 'refs/remotes/upstream/main', tip]);

		const r = run(fork, ['--json']);
		expect(r.status).toBe(0);
		const parsed = JSON.parse(r.stdout) as { upstreamAgeFrom: string };
		expect(parsed.upstreamAgeFrom).toBe('tip commit');
	});

	itWithGitWrapper('rejects an untracked path that disappears after enumeration', () => {
		write(
			fork,
			'product/disappearing.ts',
			'export const a = 1;\nexport const b = 2;\nproductOnly();\n'
		);
		const wrapper = installGitWrapper(tmp);
		const marker = join(tmp, 'removed-after-untracked');
		const r = run(fork, ['--fetch', '--json'], {
			PATH: `${wrapper}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			REMOVE_AFTER_UNTRACKED: join(fork, 'product/disappearing.ts'),
			REMOVE_MARKER: marker
		});

		expect(existsSync(marker)).toBe(true);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/working tree changed during this report/);
	});

	itWithGitWrapper('keeps an unstaged path seen before a working-tree ABA', () => {
		const path = join(fork, 'shared/pristine.ts');
		const headContent = join(tmp, 'pristine-head.ts');
		writeFileSync(headContent, 'export const a = 1;\nexport const b = 2;\n');
		writeFileSync(path, 'export const a = 1;\nexport const b = 92;\n');
		const marker = join(tmp, 'worktree-aba');
		const r = run(fork, ['--fetch', '--json'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			ABA_WORKTREE_PATH: path,
			ABA_HEAD_CONTENT: headContent,
			ABA_WORKTREE_MARKER: marker,
			ABA_HEAD: git(fork, ['rev-parse', 'HEAD'])
		});

		expect(r.status, r.stderr).toBe(0);
		expect(existsSync(marker)).toBe(true);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string }>;
		};
		expect(
			parsed.verdicts.find((verdict) => verdict.path === 'shared/pristine.ts')?.relevance
		).toBe('pristine');
	});

	itWithGitWrapper('classifies from the bytes captured with the fingerprint', () => {
		const source = Array.from({ length: 6 }, (_, i) => `export const captured${i} = ${i};`);
		write(upstream, 'shared/captured-source.ts', `${source.join('\n')}\n`);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add captured source']);
		write(fork, 'product/captured-copy.ts', 'forkOnlyBase();\nmoreForkOnlyBase();\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add fork-owned base']);
		markBase(fork);
		const path = join(fork, 'product/captured-copy.ts');
		writeFileSync(path, `${source.join('\n')}\n`);
		const original = join(tmp, 'captured-original.ts');
		const replacement = join(tmp, 'captured-replacement.ts');
		writeFileSync(original, `${source.join('\n')}\n`);
		writeFileSync(replacement, 'temporaryForkOnly();\nanotherTemporaryLine();\n');
		const marker = join(tmp, 'capture-aba');

		const r = run(fork, ['--fetch', '--json'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			ABA_CAPTURE_PATH: path,
			ABA_CAPTURE_ORIGINAL: original,
			ABA_CAPTURE_REPLACEMENT: replacement,
			ABA_CAPTURE_MARKER: marker
		});

		expect(r.status, r.stderr).toBe(0);
		expect(existsSync(marker)).toBe(true);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'product/captured-copy.ts');
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/mostly matches upstream/);
	});

	itWithGitWrapper('scores shared paths from captured bytes', () => {
		const path = join(fork, 'shared/rewritten.ts');
		const original = readFileSync(path, 'utf8');
		writeFileSync(path, original.replace('template8 = 8', 'template8 = 99'));
		const baseline = verdictsWithScore(fork, ['shared/rewritten.ts'])['shared/rewritten.ts'];
		const replacement = join(tmp, 'overlap-replacement.ts');
		writeFileSync(replacement, original.replace('forkOnly8 = 8', 'forkOnly8 = 99'));
		const marker = join(tmp, 'overlap-aba');

		const r = run(fork, ['--fetch', '--json', 'shared/rewritten.ts'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			OVERLAP_ABA_PATH: path,
			OVERLAP_ABA_REPLACEMENT: replacement,
			OVERLAP_ABA_MARKER: marker
		});

		expect(r.status, r.stderr).toBe(0);
		expect(existsSync(marker)).toBe(true);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; overlap?: number }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'shared/rewritten.ts');
		expect(verdict?.overlap).toBe(baseline?.overlap);
	});

	it('binds working-tree bytes to a checked file descriptor', () => {
		const source = readFileSync(SCRIPT, 'utf8');
		const start = source.indexOf('function workingTreeContent(');
		const end = source.indexOf('function fingerprintContent(', start);
		const capture = source.slice(start, end);
		const identityCheck = capture.indexOf('sameFileIdentity(initial, opened)');
		const boundedRead = capture.indexOf('readSync(');

		expect(identityCheck).toBeGreaterThan(0);
		expect(boundedRead).toBeGreaterThan(identityCheck);
		expect(capture).toContain('opened.size > maxBytes');
	});

	it('binds marker inspection and bytes to one file descriptor', () => {
		const source = readFileSync(SCRIPT, 'utf8');
		const start = source.indexOf('function readUpstreamMarker(');
		const end = source.indexOf('function requireCleanUpstreamMarker(', start);
		const markerRead = source.slice(start, end);
		const open = markerRead.indexOf('openSync(');
		const identity = markerRead.indexOf('sameFileIdentity(opened, atPath)');
		const read = markerRead.indexOf('readSync(');
		const finalIdentity = markerRead.indexOf('sameFileIdentity(opened, afterPath)');

		expect(open).toBeGreaterThan(0);
		expect(identity).toBeGreaterThan(open);
		expect(read).toBeGreaterThan(identity);
		expect(finalIdentity).toBeGreaterThan(read);
	});

	it('binds the selected marker to committed HEAD before shared Git writes', () => {
		const source = readFileSync(SCRIPT, 'utf8');
		const start = source.indexOf('const marker = readUpstreamMarker(root);');
		const markerAtHead = source.indexOf('requireMarkerAtHead(head, marker);', start);
		const upstreamWrite = source.indexOf('ensureUpstream(root, upstreamUrl', start);
		expect(markerAtHead).toBeGreaterThan(start);
		expect(upstreamWrite).toBeGreaterThan(markerAtHead);
	});

	it('bounds and caches source-bag preprocessing', () => {
		const source = readFileSync(SCRIPT, 'utf8');
		const start = source.indexOf('function sourceBag(');
		const end = source.indexOf('/**\n * The upstream file this content most resembles.', start);
		const preparation = source.slice(start, end);
		const budget = preparation.indexOf('content.length > upstream.similarityOperationsRemaining');
		const bag = preparation.indexOf('bagOf(text)');

		expect(preparation).toContain('sourceBags.get(content)');
		expect(budget).toBeGreaterThan(0);
		expect(bag).toBeGreaterThan(budget);
	});

	it('gives each detector subprocess a hard test timeout', () => {
		const source = readFileSync(TEST_FILE, 'utf8');
		const start = source.indexOf('function run(');
		const end = source.indexOf('function verdicts(', start);
		expect(source.slice(start, end)).toContain('timeout: 30_000');
	});

	it('isolates leftover cleanup failures to one temporary directory', () => {
		const source = readFileSync(SCRIPT, 'utf8');
		const start = source.indexOf('function sweepLeftovers(');
		const end = source.indexOf('function ensureScratchIndexExists(', start);
		const sweep = source.slice(start, end);
		const loop = sweep.indexOf('for (const name of names)');
		const perEntryCatch = sweep.indexOf('Another report may remove its directory', loop);
		expect(loop).toBeGreaterThan(0);
		expect(perEntryCatch).toBeGreaterThan(loop);
	});

	it('bounds the similarity representation of large single-line text', () => {
		write(fork, 'product/large-minified.js', `${'minifiedToken'.repeat(128)}\n`);

		const r = run(fork, ['--fetch', '--json', '--all', 'product/large-minified.js'], {
			NODE_ENV: 'test',
			UPSTREAM_REPORT_TEST_SIMILARITY_LIMIT: '1024'
		});
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'product/large-minified.js');
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/bounded similarity size/);
	});

	it('bounds the overlap map for a shared upstream path', () => {
		const path = 'shared/large-overlap.ts';
		write(
			upstream,
			path,
			`${Array.from({ length: 30 }, (_, index) => `export const upstream${index} = ${index};`).join('\n')}\n`
		);
		write(
			fork,
			path,
			`${Array.from({ length: 30 }, (_, index) => `export const fork${index} = ${index};`).join('\n')}\n`
		);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add large shared path']);
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add divergent large shared path']);
		git(fork, ['fetch', '-q', 'upstream']);
		markBase(fork);
		write(fork, path, 'export const changed = true;\n');
		git(fork, ['commit', '-qam', 'edit large shared path']);

		const r = run(fork, ['--fetch', '--json', path], {
			NODE_ENV: 'test',
			UPSTREAM_REPORT_TEST_SIMILARITY_REPRESENTATION_LIMIT: '100'
		});

		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === path);
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/bounded similarity representation/);
	});

	it('charges reused upstream blobs once against the representation budget', () => {
		const target = 'targetOne();\ntargetTwo();\ntargetThree();\ntargetFour();\n';
		write(upstream, 'shared/reused-target.rare', target);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add reusable target']);
		const duplicate = 'duplicateOne();\nduplicateTwo();\n';
		for (let index = 0; index < 5; index++) {
			write(upstream, `shared/duplicate-${index}.rare`, duplicate);
		}
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'reuse one filler blob']);
		git(fork, ['fetch', '-q', 'upstream']);
		write(
			fork,
			'product/reused-probe.rare',
			'targetOne();\ntargetTwo();\ntargetThree();\nlocalFour();\n'
		);

		const r = run(fork, ['--fetch', '--json', '--all', 'product/reused-probe.rare'], {
			NODE_ENV: 'test',
			UPSTREAM_REPORT_TEST_SIMILARITY_REPRESENTATION_LIMIT: '550'
		});

		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts[0];
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toContain('mostly matches upstream\'s "shared/reused-target.rare"');
	});

	it('charges four bytes per retained character gram', () => {
		write(upstream, 'shared/gram-source.rare', `sharedLine();\n${'x'.repeat(180)}\n`);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add gram-heavy source']);
		git(fork, ['fetch', '-q', 'upstream']);
		write(fork, 'product/gram-probe.rare', 'sharedLine();\nlocalLine();\n');

		const r = run(fork, ['--fetch', '--json', '--all', 'product/gram-probe.rare'], {
			NODE_ENV: 'test',
			UPSTREAM_REPORT_TEST_SIMILARITY_REPRESENTATION_LIMIT: '300'
		});

		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		expect(parsed.verdicts[0]?.note).toMatch(/bounded similarity representation/);
	});

	it('bounds retained upstream similarity maps and grams', () => {
		write(
			upstream,
			'shared/representation-source.rare',
			`${Array.from({ length: 30 }, (_, i) => `uniqueUpstreamLine${i}();`).join('\n')}\n`
		);
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add representation-heavy source']);
		git(fork, ['fetch', '-q', 'upstream']);
		write(fork, 'product/representation-probe.rare', 'forkProbeOne();\nforkProbeTwo();\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add representation probe']);
		markBase(fork);
		write(fork, 'product/representation-probe.rare', 'forkProbeOne();\nforkProbeThree();\n');
		git(fork, ['commit', '-qam', 'edit representation probe']);

		const r = run(fork, ['--fetch', '--json', '--all', 'product/representation-probe.rare'], {
			NODE_ENV: 'test',
			UPSTREAM_REPORT_TEST_SIMILARITY_REPRESENTATION_LIMIT: '500'
		});
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find(
			(entry) => entry.path === 'product/representation-probe.rare'
		);
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/bounded similarity representation/);
	});

	it('bounds similarity work across changed paths and upstream history', () => {
		write(fork, 'product/only-here.ts', 'export const product = false;\n');
		git(fork, ['commit', '-qam', 'edit product path']);

		const r = run(fork, ['--fetch', '--json', '--all', 'product/only-here.ts'], {
			NODE_ENV: 'test',
			UPSTREAM_REPORT_TEST_SIMILARITY_OPERATION_LIMIT: '0'
		});
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'product/only-here.ts');
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/bounded operation count/);
	});

	it('keeps aggregate working-tree capture bounded', () => {
		write(fork, 'product/capture-a.ts', 'captureAlphaToken();\ncaptureAlphaToken();\n');
		write(fork, 'product/capture-b.ts', 'captureBetaToken();\ncaptureBetaToken();\n');

		const r = run(fork, ['--fetch', '--json', '--all'], {
			NODE_ENV: 'test',
			UPSTREAM_REPORT_TEST_CAPTURE_LIMIT: '64'
		});
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'product/capture-b.ts');
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/bounded capture size/);
	});

	itWithPosixPaths('counts symlink targets against aggregate working-tree capture', () => {
		symlinkSync('a'.repeat(40), join(fork, 'product/capture-link-a'));
		symlinkSync('b'.repeat(40), join(fork, 'product/capture-link-b'));

		const r = run(fork, ['--fetch', '--json', '--all'], {
			NODE_ENV: 'test',
			UPSTREAM_REPORT_TEST_CAPTURE_LIMIT: '64'
		});
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		const verdict = parsed.verdicts.find((entry) => entry.path === 'product/capture-link-b');
		expect(verdict?.relevance).toBe('unmeasured');
		expect(verdict?.note).toMatch(/bounded capture size/);
	});

	itWithGitWrapper('refuses a disappearing private scratch index', () => {
		write(fork, 'product/staged-only.ts', 'stagedOnly();\n');
		git(fork, ['add', 'product/staged-only.ts']);
		rmSync(join(fork, 'product/staged-only.ts'));
		const indexPath = join(fork, '.git', 'index');
		const indexBefore = readFileSync(indexPath);
		const marker = join(tmp, 'scratch-index-removed');

		const r = run(fork, ['--fetch', '--json', '--all'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			REMOVE_SCRATCH_INDEX_MARKER: marker
		});

		expect(existsSync(marker)).toBe(true);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/scratch index disappeared/);
		expect(readFileSync(indexPath)).toEqual(indexBefore);
	});

	itWithGitWrapper('rejects changed entries in the private scratch index', () => {
		const upstreamBlob = git(fork, ['rev-parse', 'refs/remotes/upstream/main:shared/pristine.ts']);
		const marker = join(tmp, 'private-index-race-staged');
		const r = run(fork, ['--fetch', '--json'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			STAGE_PRIVATE_INDEX_AFTER_COPY: 'product/private-index-race.ts',
			STAGE_PRIVATE_BLOB_SHA: upstreamBlob,
			PRIVATE_INDEX_RACE_MARKER: marker
		});

		expect(existsSync(marker)).toBe(true);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/scratch index entries changed/);
	});

	itWithGitWrapper('rejects staging that races the scratch-index copy', () => {
		write(fork, 'product/staged-race.ts', 'unrelatedWorkingCopy();\n');
		const upstreamBlob = git(fork, ['rev-parse', 'refs/remotes/upstream/main:shared/pristine.ts']);
		const marker = join(tmp, 'index-race-staged');
		const r = run(fork, ['--fetch', '--json'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			STAGE_AFTER_INDEX_COPY: 'product/staged-race.ts',
			STAGE_BLOB_SHA: upstreamBlob,
			INDEX_RACE_MARKER: marker
		});

		expect(existsSync(marker)).toBe(true);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/index.*changed during this report/);
	});

	itWithGitWrapper('rejects working content that changes without a status change', () => {
		write(fork, 'product/content-race.ts', 'unrelatedA();\nunrelatedB();\n');
		const replacement = join(tmp, 'replacement-content.ts');
		writeFileSync(replacement, 'export const a = 1;\nexport const b = 2;\nproductOnly();\n');
		const marker = join(tmp, 'content-race-replaced');
		const r = run(fork, ['--fetch', '--json'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			REPLACE_AFTER_CONTENT_PATH: join(fork, 'product/content-race.ts'),
			REPLACEMENT_CONTENT: replacement,
			CONTENT_RACE_MARKER: marker
		});

		expect(existsSync(marker)).toBe(true);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/working tree changed during this report/);
	});

	itWithGitWrapper('rejects local state that changes after enumeration', () => {
		const replacement = join(tmp, 'replacement-marker.json');
		writeFileSync(replacement, JSON.stringify({ upstreamUrl: join(tmp, 'other-parent') }));
		const marker = join(tmp, 'local-state-changed');
		const r = run(fork, ['--json'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			ADD_AFTER_UNTRACKED: join(fork, 'product/late.ts'),
			REPLACEMENT_MARKER: replacement,
			UPSTREAM_MARKER: join(fork, '.upstream-sync.json'),
			LOCAL_CHANGE_MARKER: marker
		});

		expect(existsSync(marker)).toBe(true);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/working tree changed during this report/);
	});

	itWithGitWrapper('rejects an upstream ref that moves after the snapshot check', () => {
		write(upstream, 'shared/arrived-during-report.ts', 'export const fresh = 1;\n');
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'advance during report']);
		write(fork, 'shared/arrived-during-report.ts', 'export const fresh = 1;\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add same path']);

		const wrapper = installGitWrapper(tmp);
		const marker = join(tmp, 'fetched-after-reflog');
		const r = run(fork, ['--json'], {
			PATH: `${wrapper}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			FETCH_AFTER_REFLOG: '1',
			FETCH_MARKER: marker
		});

		expect(existsSync(marker)).toBe(true);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toContain('changed while this report started');
	});

	itWithGitWrapper('rejects an upstream ref that moves while the pinned tree is read', () => {
		const pinned = git(fork, ['rev-parse', 'refs/remotes/upstream/main']);
		write(upstream, 'shared/arrived-during-tree-read.ts', 'export const fresh = 1;\n');
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'advance during tree read']);
		write(fork, 'shared/arrived-during-tree-read.ts', 'export const fresh = 1;\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add same path']);

		const wrapper = installGitWrapper(tmp);
		const marker = join(tmp, 'fetched-after-tree-read');
		const r = run(fork, ['--json'], {
			PATH: `${wrapper}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			FETCH_AFTER_TREE_SHA: pinned,
			FETCH_MARKER: marker
		});

		expect(existsSync(marker)).toBe(true);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toContain('changed during this report');
	});

	it('does not reuse fetch evidence after the upstream URL changes', () => {
		const fetched = run(fork, ['--fetch', '--json', 'shared/pristine.ts']);
		expect(fetched.status, fetched.stderr).toBe(0);
		expect(git(fork, ['config', '--get', 'upstreamReport.lastFetch']).split(' ')).toHaveLength(3);
		const replacement = join(tmp, 'replacement-upstream');
		mkdirSync(replacement);
		init(replacement);
		write(replacement, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 3;\n');
		git(replacement, ['add', '-A']);
		git(replacement, ['commit', '-qm', 'replacement upstream']);
		const marker = JSON.parse(readFileSync(join(fork, '.upstream-sync.json'), 'utf8')) as Record<
			string,
			unknown
		>;
		write(fork, '.upstream-sync.json', JSON.stringify({ ...marker, upstreamUrl: replacement }));
		git(fork, ['commit', '-qam', 'replace upstream URL']);
		git(fork, ['remote', 'set-url', 'upstream', replacement]);
		markBase(fork);
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 77;\n');
		git(fork, ['commit', '-qam', 'fix shared file']);

		const r = run(fork, ['--json', 'shared/pristine.ts']);
		expect(r.status).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		expect(parsed.verdicts[0]?.relevance).toBe('unmeasured');
		expect(parsed.verdicts[0]?.note).toMatch(/no provenance from the configured upstream/);
	});

	itWithGitWrapper('uses a URL-bound fetch record while upstream is unavailable', () => {
		const fetched = run(fork, ['--base', 'origin/main', '--fetch', '--json', 'shared/pristine.ts']);
		expect(fetched.status, fetched.stderr).toBe(0);
		const r = run(fork, ['--base', 'origin/main', '--json', 'shared/pristine.ts'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			NODE_ENV: 'test',
			SLOW_LS_REMOTE: '1',
			UPSTREAM_REPORT_TEST_TIMEOUT_MS: '50'
		});

		expect(r.status, r.stderr).toBe(0);
	});

	it('does not let another remote populate upstream verdicts', () => {
		const decoy = join(tmp, 'decoy');
		mkdirSync(decoy);
		init(decoy);
		write(decoy, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 2;\n');
		git(decoy, ['add', '-A']);
		git(decoy, ['commit', '-qm', 'decoy']);
		write(upstream, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 3;\n');
		git(upstream, ['commit', '-qam', 'advance real upstream']);
		git(fork, ['remote', 'add', 'decoy', decoy]);
		git(fork, ['fetch', '-q', 'decoy', '+refs/heads/main:refs/remotes/upstream/main']);
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 77;\n');
		git(fork, ['commit', '-qam', 'fix shared file']);

		const r = run(fork, ['--json', 'shared/pristine.ts']);
		expect(r.status).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		expect(parsed.verdicts[0]?.relevance).toBe('unmeasured');
		expect(parsed.verdicts[0]?.note).toMatch(/no provenance from the configured upstream/);
	});

	it('does not measure divergence against another remote', () => {
		const decoy = join(tmp, 'diverged-decoy');
		mkdirSync(decoy);
		init(decoy);
		write(decoy, 'shared/pristine.ts', 'decoyOne();\ndecoyTwo();\n');
		git(decoy, ['add', '-A']);
		git(decoy, ['commit', '-qm', 'diverged decoy']);
		git(fork, ['remote', 'add', 'decoy', decoy]);
		git(fork, ['fetch', '-q', 'decoy', '+refs/heads/main:refs/remotes/upstream/main']);
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 77;\n');
		git(fork, ['commit', '-qam', 'fix shared file']);

		const r = run(fork, ['--json', 'shared/pristine.ts']);
		expect(r.status).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		expect(parsed.verdicts[0]?.relevance).toBe('unmeasured');
		expect(parsed.verdicts[0]?.note).toMatch(/no provenance from the configured upstream/);
	});

	it('does not trust another upstream branch as upstream main', () => {
		git(upstream, ['checkout', '-q', '-b', 'topic']);
		write(upstream, 'topic-only.ts', 'topicOnly();\n');
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'advance topic']);
		git(upstream, ['checkout', '-q', 'main']);
		write(upstream, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 3;\n');
		git(upstream, ['commit', '-qam', 'advance upstream main']);
		git(fork, ['fetch', '-q', 'upstream', '+refs/heads/topic:refs/remotes/upstream/main']);
		const subject = git(fork, [
			'reflog',
			'show',
			'-1',
			'--format=%gs',
			'refs/remotes/upstream/main'
		]);
		expect(subject).toContain('refs/heads/topic:refs/remotes/upstream/main');
		expect(gitOptional(fork, ['config', '--get', 'upstreamReport.lastFetch'])).toBe('');
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 77;\n');
		git(fork, ['commit', '-qam', 'fix shared file']);

		const r = run(fork, ['--json', 'shared/pristine.ts']);
		expect(r.status).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		expect(parsed.verdicts[0]?.relevance).toBe('unmeasured');
		expect(parsed.verdicts[0]?.note).toMatch(/no provenance from the configured upstream/);
	});

	it('rejects an origin/main self-reference the remote does not advertise', () => {
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 78;\n');
		git(fork, ['commit', '-qam', 'committed change']);
		git(fork, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);

		const r = run(fork, ['--fetch', '--json']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/origin\/main.*does not match/);
	});

	it('accepts origin/main provenance from an ordinary fetch without a remote argument', () => {
		write(fork, 'product/base-marker.ts', 'export const baseMarker = true;\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'advance fork base']);
		advertiseOriginMain(fork, 'HEAD');
		git(fork, ['fetch', '-q']);
		const subject = git(fork, ['reflog', 'show', '-1', '--format=%gs', 'refs/remotes/origin/main']);
		expect(subject).toMatch(/^fetch -q:/);
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 79;\n');
		git(fork, ['commit', '-qam', 'fix shared path']);

		const r = run(fork, ['--json']);

		expect(r.status, r.stderr).toBe(0);
	});

	it('accepts origin/main updated by a successful push', () => {
		write(fork, 'product/pushed-base.ts', 'export const pushedBase = true;\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'advance pushed base']);
		git(fork, ['push', '-q', 'origin', 'HEAD:refs/heads/main']);
		const subject = git(fork, ['reflog', 'show', '-1', '--format=%gs', 'refs/remotes/origin/main']);
		expect(subject).toBe('update by push');
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 80;\n');
		git(fork, ['commit', '-qam', 'fix after pushed base']);

		const r = run(fork, ['--json']);

		expect(r.status, r.stderr).toBe(0);
	});

	it.each([
		['option with value', ['fetch', '--depth', '1', 'origin', 'main']],
		['server option with value', ['fetch', '--server-option', 'x=y', 'origin', 'main']],
		['full refspec', ['fetch', 'origin', 'refs/heads/main:refs/remotes/origin/main']],
		['forced full refspec', ['fetch', 'origin', '+refs/heads/main:refs/remotes/origin/main']]
	])('accepts origin/main provenance from a real fetch with %s', (_name, fetchArgs) => {
		write(fork, 'product/fetch-base.ts', 'export const fetchBase = true;\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'advance fetch base']);
		advertiseOriginMain(fork, 'HEAD');
		git(fork, ['update-ref', '-d', 'refs/remotes/origin/main']);
		git(fork, fetchArgs);
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 88;\n');
		git(fork, ['commit', '-qam', 'fix after fetched base']);

		const r = run(fork, ['--json', 'shared/pristine.ts']);

		expect(r.status, r.stderr).toBe(0);
	});

	it('accepts a fetch of main alongside additional refs', () => {
		const base = git(fork, ['rev-parse', 'refs/remotes/origin/main']);
		const elsewhere = git(fork, ['rev-parse', 'refs/remotes/upstream/main']);
		git(fork, ['update-ref', 'refs/remotes/origin/main', elsewhere, base]);
		git(fork, [
			'update-ref',
			'-m',
			'fetch origin refs/heads/topic:refs/remotes/origin/topic main: fast-forward',
			'refs/remotes/origin/main',
			base,
			elsewhere
		]);
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 79;\n');
		git(fork, ['commit', '-qam', 'fix shared path']);

		const r = run(fork, ['--json']);
		expect(r.status, r.stderr).toBe(0);
	});

	it('rejects an untrusted origin/main inside the feature history', () => {
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 82;\n');
		git(fork, ['commit', '-qam', 'shared feature commit']);
		const truncatedBase = git(fork, ['rev-parse', 'HEAD']);
		write(fork, 'product/only-here.ts', 'export const product = false;\n');
		git(fork, ['commit', '-qam', 'later product commit']);
		git(fork, [
			'update-ref',
			'-m',
			'fetch origin topic: storing head',
			'refs/remotes/origin/main',
			truncatedBase
		]);

		const r = run(fork, ['--fetch', '--json']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/origin\/main.*does not match/);
	});

	it('does not trust a manually packed origin/main', () => {
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 83;\n');
		git(fork, ['commit', '-qam', 'committed change']);
		git(fork, ['update-ref', '-m', 'local rewrite', 'refs/remotes/origin/main', 'HEAD']);
		git(fork, ['pack-refs', '--all', '--prune']);

		const r = run(fork, ['--fetch', '--json']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/origin\/main.*does not match/);
	});

	it('rejects origin/main populated from another origin branch', () => {
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 81;\n');
		git(fork, ['commit', '-qam', 'committed change']);
		git(fork, [
			'update-ref',
			'-m',
			'fetch origin topic: storing head',
			'refs/remotes/origin/main',
			'HEAD'
		]);

		const r = run(fork, ['--fetch', '--json']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/origin\/main.*does not match/);
	});

	it('rejects a real default fetch that maps origin topic to origin/main', () => {
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 84;\n');
		git(fork, ['commit', '-qam', 'committed change']);
		const misleadingOrigin = join(tmp, 'topic-origin.git');
		mkdirSync(misleadingOrigin);
		git(misleadingOrigin, ['init', '--bare', '-q']);
		git(fork, ['push', '-q', misleadingOrigin, 'HEAD:refs/heads/topic']);
		git(fork, ['remote', 'set-url', 'origin', misleadingOrigin]);
		git(fork, ['config', '--unset-all', 'remote.origin.fetch']);
		git(fork, [
			'config',
			'--add',
			'remote.origin.fetch',
			'+refs/heads/topic:refs/remotes/origin/main'
		]);
		git(fork, ['fetch', '-q', 'origin']);

		const r = run(fork, ['--fetch', '--json']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/origin\/main.*not mapped exclusively/);
	});

	itWithGitWrapper('times out a stalled origin provenance check', () => {
		const wrapper = installGitWrapper(tmp);
		const r = run(fork, ['--json'], {
			PATH: `${wrapper}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			NODE_ENV: 'test',
			UPSTREAM_REPORT_TEST_TIMEOUT_MS: '100',
			SLOW_LS_REMOTE: '1'
		});

		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/Git operation timed out/);
	});

	itWithGitWrapper('rechecks upstream after final origin validation', () => {
		const expected = git(upstream, ['rev-parse', 'HEAD']);
		write(upstream, 'shared/late-upstream.ts', 'lateUpstream();\n');
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-qm', 'add late upstream state']);
		const replacement = git(upstream, ['rev-parse', 'HEAD']);
		git(fork, ['fetch', '-q', 'upstream']);
		git(upstream, ['reset', '--hard', '-q', expected]);
		git(fork, ['fetch', '-q', 'upstream']);

		const wrapper = installGitWrapper(tmp);
		const seen = join(tmp, 'origin-validated-once');
		const marker = join(tmp, 'upstream-after-origin');
		const r = run(fork, ['--json'], {
			PATH: `${wrapper}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			UPSTREAM_AFTER_ORIGIN_REPO: fork,
			UPSTREAM_AFTER_ORIGIN_SHA: replacement,
			UPSTREAM_AFTER_ORIGIN_SEEN: seen,
			UPSTREAM_AFTER_ORIGIN_MARKER: marker
		});

		expect(existsSync(marker)).toBe(true);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/tracking ref changed during this report/);
	});

	itWithGitWrapper('rejects origin/main moving during classification', () => {
		write(fork, 'shared/origin-base.ts', 'originBase();\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'advance validated origin base']);
		markBase(fork);
		const rewind = git(fork, ['rev-parse', 'HEAD^']);
		write(fork, 'product/after-origin-base.ts', 'featureAfterOriginBase();\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add feature after origin base']);

		const wrapper = installGitWrapper(tmp);
		const marker = join(tmp, 'origin-race');
		const r = run(fork, ['--fetch', '--json'], {
			PATH: `${wrapper}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			ORIGIN_RACE_SHA: rewind,
			ORIGIN_RACE_REMOTE: git(fork, ['remote', 'get-url', 'origin']),
			ORIGIN_RACE_MARKER: marker
		});

		expect(existsSync(marker)).toBe(true);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/changed during base validation/);
	});

	it('rejects origin/main after the origin URL changes', () => {
		const otherOrigin = join(tmp, 'other-origin');
		mkdirSync(otherOrigin);
		init(otherOrigin);
		write(otherOrigin, 'other.ts', 'export const otherOrigin = true;\n');
		git(otherOrigin, ['add', '-A']);
		git(otherOrigin, ['commit', '-qm', 'other origin']);
		git(fork, ['remote', 'set-url', 'origin', otherOrigin]);

		const r = run(fork, ['--fetch', '--json']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/currently configured origin URL/);
	});

	it('rejects an origin URL rewritten to the feature HEAD', () => {
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 99;\n');
		git(fork, ['commit', '-qam', 'fix shared file']);
		const configuredOrigin = git(fork, ['config', '--get', 'remote.origin.url']);
		git(fork, ['config', `url.${fork}.insteadOf`, configuredOrigin]);
		git(fork, ['fetch', '-q', 'origin']);
		expect(git(fork, ['rev-parse', 'origin/main'])).toBe(git(fork, ['rev-parse', 'HEAD']));

		const r = run(fork, ['--json']);
		expect(r.status).not.toBe(0);
		expect(r.stdout).not.toContain('Nothing to report upstream');
		expect(r.stderr).toMatch(/url\.\*\.insteadOf/);
	});

	it('accepts origin/main fetched with an explicit main argument', () => {
		write(fork, 'shared/new-base.ts', 'export const newBase = true;\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'advance origin base']);
		const origin = git(fork, ['remote', 'get-url', 'origin']);
		git(fork, ['push', '-q', '--force', origin, 'HEAD:refs/heads/main']);
		git(fork, ['fetch', '-q', 'origin', 'main']);
		write(fork, 'product/after-base.ts', 'export const afterBase = true;\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'add feature after fetched base']);

		const r = run(fork, ['--fetch', '--json']);
		expect(r.status, r.stderr).toBe(0);
	});

	it('rejects an origin refspec that excludes main', () => {
		git(fork, ['config', '--add', 'remote.origin.fetch', '^refs/heads/main']);

		const r = run(fork, ['--fetch', '--json']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/origin\/main.*not mapped exclusively/);
	});

	it('ignores inherited Git trace output paths', () => {
		const trace = join(tmp, 'inherited-git-trace.log');

		const r = run(fork, ['--fetch', '--json', 'shared/pristine.ts'], {
			GIT_TRACE: trace,
			GIT_TRACE2_EVENT: join(tmp, 'inherited-git-trace-event.log')
		});
		expect(r.status, r.stderr).toBe(0);
		expect(existsSync(trace)).toBe(false);
		expect(existsSync(join(tmp, 'inherited-git-trace-event.log'))).toBe(false);
	});

	it('ignores inherited command-scope Git config', () => {
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 85;\n');
		git(fork, ['commit', '-qam', 'fix shared file']);

		const r = run(fork, ['--fetch', '--json', 'shared/pristine.ts'], {
			GIT_CONFIG_COUNT: '1',
			GIT_CONFIG_KEY_0: 'remote.origin.fetch',
			GIT_CONFIG_VALUE_0: '+refs/heads/topic:refs/remotes/origin/main'
		});
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string }>;
		};
		expect(parsed.verdicts[0]?.relevance).toBe('pristine');
	});

	it('ignores legacy command-scope Git config', () => {
		const hidden = 'product/legacy-hidden.ts';
		write(fork, hidden, 'export const inheritedCopy = true;\n');
		const excludes = join(tmp, 'legacy-excludes');
		writeFileSync(excludes, `${hidden}\n`);

		const r = run(fork, ['--fetch', '--json'], {
			GIT_CONFIG_PARAMETERS: `'core.excludesFile'='${excludes}'`
		});
		expect(r.status, r.stderr).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string }>;
		};
		expect(parsed.verdicts.find((verdict) => verdict.path === hidden)?.relevance).toBe(
			'unmeasured'
		);
	});

	it('ignores replacement refs while reading the pinned upstream tree', () => {
		const upstreamTip = git(fork, ['rev-parse', 'refs/remotes/upstream/main']);
		const emptyTree = gitInput(fork, ['mktree'], '');
		const emptyCommit = git(fork, ['commit-tree', emptyTree, '-m', 'empty replacement']);
		git(fork, ['replace', upstreamTip, emptyCommit]);
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 79;\n');
		git(fork, ['commit', '-qam', 'fix shared file']);

		expect(verdicts(fork, ['shared/pristine.ts'])['shared/pristine.ts']).toBe('pristine');
	});

	it('refuses an index with unresolved merge stages', () => {
		const ours = gitInput(fork, ['hash-object', '-w', '--stdin'], 'fork content\n');
		const theirs = git(fork, ['rev-parse', 'refs/remotes/upstream/main:shared/pristine.ts']);
		gitInput(
			fork,
			['update-index', '--index-info'],
			`100644 ${ours} 2\tproduct/conflict.ts\n100644 ${theirs} 3\tproduct/conflict.ts\n`
		);

		const r = run(fork, ['--fetch', '--json', 'product/conflict.ts']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/unresolved merge stages/);
		expect(r.stderr).toContain('product/conflict.ts');
	});

	itWithPosixPaths('escapes controls in unresolved-index diagnostics', () => {
		const escape = String.fromCharCode(27);
		const path = `product/${escape}[2J${escape}]0;spoofed${String.fromCharCode(7)}.ts`;
		const ours = gitInput(fork, ['hash-object', '-w', '--stdin'], 'ours\n');
		const theirs = gitInput(fork, ['hash-object', '-w', '--stdin'], 'theirs\n');
		gitInput(
			fork,
			['update-index', '-z', '--index-info'],
			Buffer.concat([
				Buffer.from(`100644 ${ours} 2\t${path}\0`),
				Buffer.from(`100644 ${theirs} 3\t${path}\0`)
			])
		);

		const r = run(fork, ['--fetch', '--json']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).not.toContain(escape);
		expect(r.stderr).not.toContain(String.fromCharCode(7));
		expect(r.stderr).toContain('\\u001b[2J');
	});

	it('case-folds a unique filename after relocation', () => {
		write(fork, 'product/config.ts', 'export const productConfig = 99;\n');
		git(fork, ['add', '-A']);
		git(fork, ['commit', '-qm', 'relocate config']);

		const r = run(fork, ['--fetch', '--json', 'product/config.ts']);
		expect(r.status).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string; note?: string }>;
		};
		expect(parsed.verdicts[0]?.relevance).toBe('unmeasured');
		expect(parsed.verdicts[0]?.note).toContain('shared/Config.ts');
	});

	it('copies an index written in version 4 format', () => {
		git(fork, ['update-index', '--index-version', '4']);
		write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 80;\n');

		const r = run(fork, ['--fetch', '--json', 'shared/pristine.ts']);
		expect(r.status, `script failed: ${r.stderr}`).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			verdicts: Array<{ path: string; relevance: string }>;
		};
		expect(parsed.verdicts[0]?.relevance).toBe('pristine');
	});

	it('does not touch a split index backing file', () => {
		git(fork, ['config', 'core.splitIndex', 'true']);
		git(fork, ['update-index', '--split-index']);
		const gitDir = resolve(fork, git(fork, ['rev-parse', '--git-dir']));
		const shared = readdirSync(gitDir).find((name) => name.startsWith('sharedindex.'));
		expect(shared).toBeDefined();
		const backing = join(gitDir, shared!);
		const old = new Date('2020-01-02T03:04:05Z');
		utimesSync(backing, old, old);
		const before = statSync(backing).mtimeMs;

		const r = run(fork, ['--fetch', '--json', 'shared/pristine.ts']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/split index/);
		expect(statSync(backing).mtimeMs).toBe(before);
	});

	itWithGitWrapper('checks split-index state from the copied bytes', () => {
		const indexPath = join(fork, '.git', 'index');
		const ordinary = join(tmp, 'ordinary-index');
		writeFileSync(ordinary, readFileSync(indexPath));
		git(fork, ['config', 'core.splitIndex', 'true']);
		git(fork, ['update-index', '--split-index']);
		const split = join(tmp, 'split-index');
		writeFileSync(split, readFileSync(indexPath));
		const gitDir = resolve(fork, git(fork, ['rev-parse', '--git-dir']));
		const shared = readdirSync(gitDir).find((name) => name.startsWith('sharedindex.'));
		expect(shared).toBeDefined();
		const backing = join(gitDir, shared!);
		const old = new Date('2020-01-02T03:04:05Z');
		utimesSync(backing, old, old);
		const before = statSync(backing).mtimeMs;
		const marker = join(tmp, 'index-aba');

		const r = run(fork, ['--fetch', '--json', 'shared/pristine.ts'], {
			PATH: `${installGitWrapper(tmp)}:${process.env.PATH ?? ''}`,
			REAL_GIT: realGitPath(),
			INDEX_ABA_PATH: indexPath,
			INDEX_ABA_ORDINARY: ordinary,
			INDEX_ABA_SPLIT: split,
			INDEX_ABA_MARKER: marker
		});

		expect(existsSync(`${marker}.swapped`)).toBe(true);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/split index/);
		expect(statSync(backing).mtimeMs).toBe(before);
	});

	itWithGitWrapper(
		'accepts the standard GitHub HTTPS and SSH spellings as one repository',
		() => {
			const marker = JSON.parse(readFileSync(join(fork, '.upstream-sync.json'), 'utf8')) as Record<
				string,
				unknown
			>;
			write(
				fork,
				'.upstream-sync.json',
				JSON.stringify({
					...marker,
					upstreamUrl: 'https://github.com/stickerdaniel/saas-starter.git'
				})
			);
			git(fork, ['commit', '-qam', 'record GitHub parent']);
			markBase(fork);
			write(fork, 'shared/pristine.ts', 'export const a = 1;\nexport const b = 99;\n');
			git(fork, ['commit', '-qam', 'edit shared path']);
			const wrapper = installGitWrapper(tmp);
			const upstreamSha = git(fork, ['rev-parse', 'refs/remotes/upstream/main']);

			for (const remote of [
				'git@github.com:stickerdaniel/saas-starter.git',
				'git@github.com:stickerdaniel/saas-starter',
				'ssh://git@github.com/stickerdaniel/saas-starter',
				'https://github.com/StickerDaniel/SaaS-Starter',
				'https://github.com/stickerdaniel/saas-starter/'
			]) {
				git(fork, ['remote', 'set-url', 'upstream', remote]);
				const r = run(fork, ['--base', 'origin/main', '--json', 'shared/pristine.ts'], {
					PATH: `${wrapper}:${process.env.PATH ?? ''}`,
					REAL_GIT: realGitPath(),
					FAKE_REMOTE_MAIN_SHA: upstreamSha
				});
				expect(r.status, `${remote}: ${r.stderr}`).toBe(0);
				const parsed = JSON.parse(r.stdout) as {
					verdicts: Array<{ path: string; relevance: string }>;
				};
				expect(parsed.verdicts[0]).toEqual({
					path: 'shared/pristine.ts',
					relevance: 'pristine',
					report: true
				});
			}
		},
		15_000
	);

	it.each([
		['ssh://git@h/owner/template.git', 'git@h:owner/template.git'],
		['https://h/owner/template.git', 'https://h/owner/template']
	])('keeps distinct Git server paths separate: %s and %s', (markerUrl, remoteUrl) => {
		write(fork, '.upstream-sync.json', JSON.stringify({ upstreamUrl: markerUrl }));
		git(fork, ['commit', '-qam', 'set exact parent address']);
		git(fork, ['remote', 'set-url', 'upstream', remoteUrl]);

		const r = run(fork, []);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/different repository/i);
	});

	it('sweeps up an index copy an earlier run left behind', () => {
		// SIGTERM and SIGHUP do not reach the exit listener, and a handler for them
		// is worse than the leak: this script sits inside execFileSync almost the
		// whole run, a JS handler cannot run until the event loop turns, and
		// installing one only replaces the default disposition, so the run stops
		// answering SIGTERM at all. Cleaning up on the way in covers every way the
		// previous run can have died.
		const leftover = mkdtempSync(join(tmpdir(), 'upstream-relevance-index-'));
		writeFileSync(join(leftover, 'index'), 'stale');
		writeFileSync(join(leftover, 'owner'), '999999999');
		const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
		utimesSync(leftover, old, old);

		// And two directories the detector cannot prove it owns.
		const fresh = mkdtempSync(join(tmpdir(), 'upstream-relevance-index-'));
		writeFileSync(join(fresh, 'index'), 'in use');
		const unrelated = mkdtempSync(join(tmpdir(), 'upstream-relevance-index-'));
		writeFileSync(join(unrelated, 'keep'), 'unrelated');
		utimesSync(unrelated, old, old);

		try {
			expect(run(fork, ['--json']).status).toBe(0);
			expect(existsSync(leftover)).toBe(false);
			expect(existsSync(fresh)).toBe(true);
			expect(existsSync(unrelated)).toBe(true);
		} finally {
			rmSync(fresh, { recursive: true, force: true });
			rmSync(unrelated, { recursive: true, force: true });
			rmSync(leftover, { recursive: true, force: true });
		}
	});

	it('does not sweep an old index copy owned by a live report', () => {
		const active = mkdtempSync(join(tmpdir(), 'upstream-relevance-index-'));
		writeFileSync(join(active, 'index'), 'in use');
		writeFileSync(join(active, 'owner'), String(process.pid));
		const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
		utimesSync(active, old, old);

		try {
			expect(run(fork, ['--json']).status).toBe(0);
			expect(existsSync(active)).toBe(true);
		} finally {
			rmSync(active, { recursive: true, force: true });
		}
	});

	it('rejects an origin rewrite before template self-detection', () => {
		const decoy = join(tmp, 'self-detection-decoy');
		mkdirSync(decoy);
		init(decoy);
		write(decoy, 'decoy.ts', 'export const decoy = true;\n');
		git(decoy, ['add', '-A']);
		git(decoy, ['commit', '-qm', 'add self-detection decoy']);
		git(fork, ['remote', 'set-url', 'origin', upstream]);
		git(fork, ['config', `url.${decoy}.insteadOf`, upstream]);

		const r = run(fork, []);
		expect(r.status).not.toBe(2);
		expect(r.stderr).toMatch(/url\.\*\.insteadOf/);
		expect(r.stderr).not.toContain('IS the upstream template');
	});

	it('detects the template across standard GitHub HTTPS and SSH spellings', () => {
		const marker = JSON.parse(readFileSync(join(fork, '.upstream-sync.json'), 'utf8')) as Record<
			string,
			unknown
		>;
		write(
			fork,
			'.upstream-sync.json',
			JSON.stringify({
				...marker,
				upstreamUrl: 'https://github.com/stickerdaniel/saas-starter.git'
			})
		);
		git(fork, ['commit', '-qam', 'record GitHub parent']);
		git(fork, ['remote', 'set-url', 'origin', 'git@github.com:stickerdaniel/saas-starter.git']);

		const r = run(fork, []);

		expect(r.status).toBe(2);
		expect(r.stderr).toContain('IS the upstream template');
	});

	it('refuses to classify the template against itself', () => {
		// The skill ships to the template too, where every fork inherits it. There
		// the repository IS upstream, so there is nothing to report and every
		// verdict would be a comparison with itself.
		git(fork, ['remote', 'set-url', 'origin', upstream]);

		const r = run(fork, []);
		expect(r.status).toBe(2);
		expect(r.stderr).toContain('IS the upstream template');
	});
});
