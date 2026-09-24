# GitHub Actions

Use patdown on pull requests as a fuzzy check over **changed files**, not the whole tree. The workflow (or composite action) builds a path list; patdown intersects that list with each rule's globs and judges only the survivors.

## Recommended: composite action

```yaml
- uses: actions/checkout@v5
  with:
    fetch-depth: 0

- uses: tyler-dot-earth/patdown@v0.7.0
  with:
    github-annotation: warning
  env:
    TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}
```

Pin the action tag to a released version. By default the action installs that same `patdown` npm version (`tyler-dot-earth/patdown@v0.7.0` → `npx patdown@0.7.0`). Override with `version` only when you intentionally want a different CLI.

Inputs:

| Input | Default | Meaning |
| --- | --- | --- |
| `version` | action tag's CLI version | npm dist-tag / version for `npx patdown@…` |
| `working-directory` | `.` | cwd for rules discovery and the file list |
| `rules` | unset | `--rules` file or pack directory |
| `files-from` | auto under `RUNNER_TEMP` | skip auto diff and pass your own list |
| `github-annotation` | unset | `--github-annotation` (`error` / `warning` / `notice`) |
| `yes-threshold` | unset | `--yes-threshold` |
| `max-judgments` | unset | `--max-judgments` — planned file/rule evaluations; evidence calls are additional |
| `verbose` | `true` | `--verbose` |
| `no-github` | `false` | `--no-github` |
| `node-version` | `22.22.2` | Node for `setup-node` |

Required around the action:

- Secret `TYPESAFE_API_KEY` for the default judge
- `fetch-depth: 0` on checkout so the base commit exists
- Run from a checkout that has your `AGENTS.PATDOWN.md` (or pass `rules`)

Fork pull requests do not receive repository secrets. The example workflow skips those events.

Copy [examples/github-actions/patdown.yml](../examples/github-actions/patdown.yml) if you want a full workflow file. This repository dogfoods a local-dist variant in [`.github/workflows/patdown.yml`](../.github/workflows/patdown.yml) instead of the published action, so CI exercises the branch under test.

## Manual CLI (copy-paste)

Same behavior without the action. On a pull request, `$BASE` is the base SHA; on push, use the previous commit:

```sh
if [ "$GITHUB_EVENT_NAME" = "pull_request" ]; then
  BASE="$PULL_REQUEST_BASE_SHA"
else
  BASE="${GITHUB_EVENT_BEFORE:-$(git rev-parse HEAD^)}"
fi
git diff --name-only --diff-filter=ACMR "$BASE"...HEAD > "$RUNNER_TEMP/patdown-changed-files.txt"
npx patdown --verbose --files-from "$RUNNER_TEMP/patdown-changed-files.txt"
```

`--files path` may be repeated. Paths may be files, directories, or globs. Directories expand to every file under them (same skipped directories as rule globs). `--files` and `--files-from` may be combined. `--files-from -` reads newline-separated paths from stdin. Blank lines and `#` comments in the list are ignored. Paths outside cwd, the usual skipped directories (`.git`, `dist`, `node_modules`, …), and common credential filenames (`.env`, `*.pem`, `id_rsa`, …) are dropped. A missing `--files-from` file or missing `--files` path fails the command. An empty selection after filtering is still `patdown: passed`. Before judgments, patdown prints how many selected files and rules it will lint.

When a path list is set, rules whose globs miss every listed file stay quiet. Without a path list, an empty glob still prints `patdown: no files matched …`.

## Job summary and annotations

When `GITHUB_ACTIONS=true` and `GITHUB_STEP_SUMMARY` are set, the default CLI also:

1. Prints workflow-command annotations for failing file/rule pairs (hottest first, capped at 10), including the rule title, globs, and full rule body under the probability line
2. Appends a markdown heatmap to the step summary

Annotation level is display only. It does not change whether a yes judgment fails the run. Levels are `error`, `warning`, and `notice` (GitHub has no `::info`). Resolution, most specific wins:

1. per-rule `github-annotation:` metadata
2. rules-file frontmatter `github-annotation:`
3. `--github-annotation` / package.json `patdown.githubAnnotation` / action input `github-annotation`
4. built-in default: `error`

```
---
include:
  - ./node_modules/@patdown/packs/typescript
github-annotation: warning
---

# No title case
globs: **/*.md
github-annotation: error

Markdown headings must use sentence case.
```

```json
{
  "patdown": {
    "githubAnnotation": "warning"
  }
}
```

```sh
npx patdown --github-annotation warning --files-from changed.txt
```

PASS stays one noul judgment. On FAIL, the default TypeSafe judge makes a second Choice call whose candidates are individual lines (full file + original P(yes) in state). Files larger than the per-line cap fall back to chunks. Later we may offer smarter units (functions, headings, hunks) the same way. If that Choice is unavailable, returns `noMatch`, or fails, the annotation still lands on the file at `line=1`.

The summary leads with `patdown passed` or `patdown failed`, then `N passed · M failed · elapsed`. Each heatmap row has a `status` column with ✅ or ❌. Any failed rule marks the whole file row ❌. Judged cells show the shade bar and score; failures append ❌ after the score.

Stdout stays the normal PASS/FAIL lines and ends with `patdown: passed` or `patdown: failed`. `--verbose` still adds the shade bar, cutoff, and elapsed time. Opt out with `--no-github` (or action input `no-github: true`).

## Custom output shapes

The composite action always runs the published CLI. It does not take an output plugin. If you need a different report shape (JSON lines, your own annotations, a dashboard upload, silence with a side channel), skip the action and embed `runPatdownCli` with your own `PatdownOutput` layer. See [Custom output](../README.md#custom-output) in the root README.

Useful pieces when you embed:

- `PatdownOutput` / `PatdownOutputLive` for local console
- `makePatdownGitHubActionsOutputLive` / `PatdownGitHubActionsOutputLive` for the stock summary + annotations
- `formatPatdownGitHubActionsAnnotations` / `formatPatdownGitHubActionsSummary` if you want the GitHub text without the default layer

Rule-source adapters and output layers are separate: swap one, both, or neither. The action path is for “run stock patdown on changed files.” The library path is for “own the I/O.”

## Diffs vs files

File lint sends `path:` plus file contents to the judge. That is what the workflow above does.

Piping `git diff` into `ask --stdin` is a separate, optional check. Large diffs can hit the provider token limit; see [jev input limits](jev-input-limits.md). Do not use a diff pipe as a substitute for `--files-from` when the rule needs the whole file.
