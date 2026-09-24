# patdown

Standalone CLI that lints a tree against fuzzy rules in one markdown file. Wrap it as a hook, plugin, or extension.

The judge is swappable. The default backend uses Effect `Decision` / `DecisionModel` with TypeSafe; rules and CLI commands use a provider-neutral interface.

## Install

```
npx patdown --help
pnpm add -D patdown
```

Requires Node.js >=22.22.2. The library entry is `patdown`; rule adapters import `@patdown/rules`. Optional agent packages: `@patdown/pi` (Pi write steering) and `@patdown/claude` (Claude Code Write/Edit hooks). See [Pi write steering](docs/pi.md) and [Claude Code plugin](docs/claude.md).

For GitHub Actions, prefer the composite action over copy-paste yaml:

```yaml
- uses: tyler-dot-earth/patdown@v0.7.0
  env:
    TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}
```

See [GitHub Actions](docs/github-actions.md). The action always runs the published CLI. Custom report shapes stay an embed of `runPatdownCli` with your own `PatdownOutput` layer ([Custom output](#custom-output)), not an action input.

## Requirements

Node.js **>=22.22.2** and pnpm **11.8.0**. CI runs checks and built-CLI smoke tests on Node 22.22.2 and Node 24. Releases through v0.2.2 require Node >=24.18.0 and use `#/` import aliases that Node 22 rejects.

## Commands

From this repo, prefer the workspace script. It builds `patdown` through Turborepo (`dependsOn: build`) and then runs the CLI from your current directory:

```
pnpm -w patdown
pnpm -w patdown -- --rules ./rules.md
pnpm -w patdown -- --rules ./packs/typescript --verbose
pnpm -w patdown -- rules
pnpm -w patdown -- doctor
pnpm -w patdown -- ask "Is this markdown heading title case?" --input-text "# Hello World"
pnpm -w patdown -- ask "Is this urgent?" --input-text "ASAP" --verbose
pnpm -w patdown -- --yes-threshold 0.9
pnpm -w patdown -- --github-annotation warning
pnpm -w patdown -- --files src/cli.ts --files README.md
pnpm -w patdown -- --files src
pnpm -w patdown -- --files 'src/**/*.ts'
pnpm -w patdown -- --files-from changed.txt --verbose
pnpm -w patdown -- --max-judgments 100
git ls-files 'src' | pnpm -w patdown -- --files-from -
```

Do not run `pnpm build` by hand just to exercise the CLI, and do not use bare `npx patdown` against an unpublished branch (that installs the last registry version). After a release, consumers use `npx patdown` / `pnpm add -D patdown` as usual.

Default command lints from the current directory. `rules` prints what it loaded. `doctor` loads the same rules and checks `TYPESAFE_API_KEY` in this process without calling the judge. `ask` answers a yes/no question, no files involved. It prints `yes` or `no`; `--verbose` also shows a P(yes) shade bar, the cutoff, and how long the judge call took. The old `--noul` and `--state` flags have been replaced by a positional question and `--input-text`.

To judge piped output, use `--stdin`:

```sh
git diff --cached | pnpm -w patdown -- ask "Does this diff introduce debugging statements?" --stdin
printf 'ASAP: production is down\n' | pnpm -w patdown -- ask "Is this urgent?" --stdin
```

These send the piped content to the configured judge. Do not pipe secrets. `--stdin` reads UTF-8 text through EOF, preserving newlines; it cannot be combined with `--input-text`. Without either option, the input is an empty string. `ask` reports yes/no without treating yes as a failing exit status.

Walks up from cwd looking for `AGENTS.PATDOWN.md`. `--rules` skips that walk and uses the path you pass.

A leading `---` frontmatter block may have one `include` key: a path, or a YAML list of paths, relative to the including file. It may also set `github-annotation:` for FAIL annotations in GitHub Actions. A directory loads every `*.md` except `README.md` (a pack). A markdown file loads that file's `#` rules. Included rules load first, then the local `#` rules. Duplicate titles fail the run. Cycles fail the run. A second `include:` key, unknown keys, and an unterminated fence fail the run. `--rules` still replaces the walk; if that file has frontmatter includes, they are followed. Pi uses the same loader, so includes work there too.

## Adapters

The default rule source parses markdown. Swap it with a module that exports `loadPatdownRules(override)` (no `effect` import) or `PatdownRuleSourceLive`, an Effect Layer for `PatdownRuleSource`. Use the plain export when the app is on another Effect major.

```
pnpm -w patdown -- --adapter ./patdown-yaml-rules.js
```

Or in the nearest `package.json` walking up from cwd:

```
{
  "patdown": {
    "adapter": "./patdown-yaml-rules.js",
    "yesThreshold": 0.9,
    "githubAnnotation": "warning"
  }
}
```

`--adapter` wins over package.json. `--rules` is still passed to the adapter as an override path.

```
import { PatdownRuleSource } from '@patdown/rules'
import { Effect, Layer } from 'effect'

export const PatdownRuleSourceLive = Layer.succeed(PatdownRuleSource, {
  loadPatdownRules: () =>
    Effect.succeed({
      patdownRules: [
        {
          patdownRuleTitle: 'No title case',
          patdownRuleBody: 'Headings use sentence case.',
          patdownRuleGlobs: ['**/*.md'],
        },
      ],
      patdownRulesFilePath: 'yaml-rules',
    }),
})
```

Load files however you want inside `loadPatdownRules`. `@patdown/rules` exports `findPatdownRulesFilePath` if you still want to walk up for a filename.

If you wrap the CLI as a hook and already have a layer, skip discovery:

```
import { Effect } from 'effect'
import { runPatdownCli } from 'patdown'

await Effect.runPromise(runPatdownCli(PatdownRuleSourceLive))
```

See [the adapter guide](docs/rule-source-adapters.md) for the interface, a multi-file parser, resolution rules, resource lifetimes, and local development setup. Adapters execute trusted local code. Install the CLI from npm as `patdown`; adapters import `@patdown/rules` and may import `patdown` for types.

## Agent write steering

[`@patdown/pi`](packages/patdown-pi/) judges Pi `write` and `edit` against the same rules. Default is block-before-write; `/patdown steer` and `/patdown warn` can report after the file lands instead. See [Pi write steering](docs/pi.md).

```sh
pi install npm:@patdown/pi
```

[`@patdown/claude`](packages/patdown-claude/) is a Claude Code plugin with a `Write|Edit` PreToolUse hook (block before disk) plus a `/patdown:run-patdown` skill. Best-effort until validated with Claude Code locally. See [Claude Code plugin](docs/claude.md).

```sh
claude --plugin-dir ./packages/patdown-claude
```

## Packs

Optional rule bundles live under [`packs/`](packs/README.md) and publish as [`@patdown/packs`](packages/patdown-packs/). The CLI only runs rules; packs are content you can take all of, some of, or skip. `@patdown/rules` is the parser library, not these files.

- [`packs/typescript`](packs/typescript/) — `@patdown/packs/typescript`
- [`packs/effect`](packs/effect/) — `@patdown/packs/effect`
- [`packs/anti-slop`](packs/anti-slop/) — `@patdown/packs/anti-slop`

Compose packs and individual rules with project rules in `AGENTS.PATDOWN.md` (Pi picks this up automatically). One `include` key: a path, or a YAML list.

```
---
include:
  - ./node_modules/@patdown/packs/typescript
  - ./node_modules/@patdown/packs/effect/prefer-effect-fn-for-named-effectful-work.md
  - ./rules/no-title-case.md
---

# Keep secrets out of committed files
globs: **/*

Do not commit API keys or tokens.
```

Or point `--rules` at one origin:

```sh
patdown --rules ./node_modules/@patdown/packs/effect --files-from changed.txt --verbose
patdown --rules ./node_modules/@patdown/packs/typescript/do-not-launder-types-with-casts.md
```

`--rules` accepts a markdown file or a directory of rule files (every `*.md` except `README.md`). Prefer stacked, backtick-wrapped `globs:` lines; commas inside one `globs:` value are separators.

## Rules

One `# heading` per rule. Optional `globs:`, `yes-threshold:`, and `github-annotation:` lines sit immediately under the heading, in any order. Commas or spaces, extra `globs:` lines stack. A second `yes-threshold:` or `github-annotation:` line is an error. Optional YAML frontmatter at the top of the file lists `include:` origins and may set a default `github-annotation:`. Other text above the first heading is ignored. Headings inside fenced code are ignored. Only `#` headings start rules; `##` and deeper headings stay in the rule body, so sections like `## Not allowed` and `## Exceptions` are fine.

```
# No title case
globs: **/*.md
yes-threshold: 0.9
github-annotation: error

Markdown headings must use sentence case, not title case.
```

No globs means `**/*`. Globs are relative to cwd, not to the rules file. Always skipped: `.git`, `.turbo`, `coverage`, `dist`, `node_modules`, plus common credential filenames (`.env` / `.env.*`, `*.pem`, `id_rsa` / `id_rsa.*`, `credentials.json`, `secrets.yaml` / `secrets.yml`). Directory matches from empty globs are dropped before reading; only files go to the judge.

## Lint

Each matched file goes to the judge as "does this file violate the following patdown rule?" The evaluated text is `path:` plus the file contents. One file at a time. Files matched by several rules are judged once per matching rule, so a rule pack multiplies the call count. A file matched by several rules is read from disk once and every one of those rules judges that same snapshot — which is there for within-run consistency and fewer disk reads, not for fewer API calls. A FAIL costs one more call to locate the evidence. There is no result cache across runs, so watch TypeSafe usage on large trees, and see `--max-judgments` below.

A rule with no matches prints `patdown: no files matched ...` and does not fail.

```
FAIL README.md: No title case
patdown: failed
```

Exit 1 on a violation, a missing rules file, a read error, an invalid cutoff, an exceeded judgment budget, or a judge error. Add `--verbose` for per-rule console boxes that stream as each file is judged (shade bar, P(yes), elapsed). Quiet mode stays one `PASS`/`FAIL` line per judgment. Lint totals elapsed time across every rule/file pair.

```
patdown: linting 1 file against 1 rule
┌ Do not launder types with casts ───────────────────────── 1
│
├─ apps/foo
│
│  ✗  ▓▓▓▓▓▓▓▓▒░  0.86   312ms  service.ts
└ 1✗ / 1

patdown: failed (elapsed: 1840ms)
```

`--files` (repeatable) and `--files-from` accept files, directories, or globs, then intersect with each rule's globs. That is how CI should run over a pull request. See [GitHub Actions](docs/github-actions.md).

`--max-judgments N` limits the number of planned file/rule evaluations. Evidence requests are additional; this is not a total-request or monetary budget. Patdown resolves every rule's file list before the first judge call, so a run whose plan is larger than the limit stops without sending anything:

```
patdown: refusing to start: 412 file judgments planned, --max-judgments is 100. Narrow the run with --files or --files-from, or raise the cap.
```

What is counted is file/rule pairs. For J planned evaluations, each FAIL adds one evidence call, so the run makes between J and 2J requests. J may be less than the configured cap. There is no limit by default.

It is also a workload limit rather than a spending one in a second sense: the same file evaluated against two rules is two judgments and should be, because they are two different questions. Reading the file twice is what the run avoids, not asking about it twice.

Patdown counts estimated P(yes) strictly above the cutoff as yes; for lint, yes means violation. Default cutoff is 0.85. Override it with `--yes-threshold`, package.json `patdown.yesThreshold`, or a per-rule `yes-threshold:` line. The flag wins over package.json; a per-rule value wins for that rule only. `1` is rejected because nothing can exceed it. This cutoff belongs to patdown, not the provider.

See [judge providers](docs/judge-providers.md) for custom layers and the TypeSafe Decision adapter.

## Large inputs and API errors

Jev has a token budget, not a fixed safe diff size. Direct testing of `jev-1.13.0` accepted a 96,768-byte synthetic diff but rejected 97,536 bytes with HTTP 400 and `max_tokens_exceeded`; a larger, low-token input still succeeded. Different text, questions, and models can move that boundary.

The TypeSafe adapter reports HTTP status, recognized provider error codes, input byte count, and a TypeSafe request ID when available. It distinguishes token limits from HTTP payload, authentication, rate/quota, and server failures without printing raw response bodies. It does not silently truncate input.

See [the measured results and live probe commands](docs/jev-input-limits.md), including how to compare a separate Vercel AI Gateway integration.

## Custom output

Embedded callers can replace `PatdownOutput` instead of using the default yes/no and lint formatting. Pass an output Layer as the fourth argument to `runPatdownCli`:

```ts
import { Console, Effect, Layer } from 'effect'
import { PatdownOutput, patdownJudgmentIsYes, runPatdownCli } from 'patdown'

const JsonOutputLive = Layer.succeed(PatdownOutput, {
	writeAnswer: (judgment, _verbose) =>
		Console.log(
			JSON.stringify({
				answer: patdownJudgmentIsYes(judgment) ? 'yes' : 'no',
				yesProbability: judgment.yesProbability,
			}),
		),
	writeLintResult: (result, _verbose) => Console.log(JSON.stringify(result)),
	writeLintRuleStart: () => Effect.void,
	writeLintStart: (ruleCount, selectionFileCount) =>
		Console.log(JSON.stringify({ ruleCount, selectionFileCount })),
	writeRulesDocument: (document) => Console.log(JSON.stringify(document)),
	writeNoFilesMatched: (ruleTitle) => Console.log(JSON.stringify({ skipped: ruleTitle })),
	writeLintOk: () => Console.log(JSON.stringify({ status: 'ok' })),
	writeLintFailed: () => Console.log(JSON.stringify({ status: 'failed' })),
})

await Effect.runPromise(
	runPatdownCli(
		undefined, // default rule-source discovery
		process.argv.slice(2),
		undefined, // default judge
		JsonOutputLive,
	),
)
```

The output service receives structured judgments and lint results, including probabilities even when `--verbose` is off. Your layer decides what to print, collect, or omit. Formatting does not change the cutoff or exit status. The example emits one JSON object per output event, not a single JSON document for the entire run.

This is an embedding API, not a `--format` flag, action input, or dynamically discovered output plugin. The GitHub composite action cannot swap output layers; it only forwards CLI flags. If you need JSON, custom annotations, or a side channel, embed `runPatdownCli` in your own Node entrypoint and call that from Actions (or anywhere else). Supply any dependencies inside your output layer; its effects must handle their own failures. CLI help, argument errors, and loading/provider errors still use the CLI's existing help/stderr paths rather than this service. Install `patdown` from npm for embeddings. Custom adapters still need a matching Effect version.

## Env

With the default TypeSafe backend, `TYPESAFE_API_KEY` is required for lint and `ask`. Optional `TYPESAFE_BASE_URL` (default `https://api.typesafe.ai`) and `TYPESAFE_DEFAULT_MODEL` (default `jev-latest`).

`pnpm -w patdown` inherits `TYPESAFE_*` from your environment.

## Release

Version lives in `apps/patdown/package.json`. That is what `patdown --version` prints.

```
pnpm -w release patch
pnpm -w release minor
pnpm -w release major
```

First write and commit `releases/vX.Y.Z.md` with the next version's notes. The release command requires a clean tree and validates those notes before changing anything. It runs `pnpm check`, bumps the CLI version, commits, tags `vX.Y.Z`, and pushes to `github` and `gitea` if present. With `gh` available, it watches the matching Release workflow.

The tag workflow runs checks again, creates a GitHub Release using the checked-in notes, and publishes `patdown`, `@patdown/rules`, `@patdown/pi`, `@patdown/claude`, and `@patdown/packs` to npm. See [the release process](releases/README.md) for the metadata format and backfilling published notes.

Pull requests and pushes to `main` run `pnpm check:ci`. That is the package check (oxlint, format, tests, typecheck) plus build so smoke tests have `dist/`. Not the fuzzy linter.

## Related

Inspired by [pi-warden](https://github.com/DevMortimer/pi-warden). Same idea, inside pi.

[Abide](https://github.com/coldteadotai/abide) is a similar Jev-backed checker. It hooks into coding agents, reads project instruction files, and asks Jev whether each edit or turn broke a rule.

[Jev Review](https://github.com/devagrawal09/jev-review) is a Jev-backed diff/codebase reviewer with a local dashboard of those judgments. Patdown stays in the terminal; `--verbose` draws a P(yes) shade bar instead of a GUI.

[Dillon Mulroy's anti-slop](https://github.com/dmmulroy/anti-slop) is the Oxlint ruleset that [`packs/anti-slop`](packs/anti-slop/) rephrases for fuzzy judging. Keep the static rules for exact AST hits; use the pack for paraphrases and type-laundering that still looks clean to a linter.

Name inspired by It's Always Sunny in Philadelphia

<img width="511" height="415" alt="image" src="https://github.com/user-attachments/assets/f7c73138-3914-4fbd-9e6b-7a37d161334a" />
