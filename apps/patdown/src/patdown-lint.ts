import { isAbsolute, resolve } from 'node:path'

import {
	defaultPatdownYesThreshold,
	PatdownYesThresholdInvalid,
	type PatdownRule,
	type PatdownRulesDocument,
	type PatdownYesThreshold,
} from '@patdown/rules'
import { Clock, Effect, FileSystem, Option, Path } from 'effect'

import {
	formatPatdownEvidenceChoiceState,
	patdownEvidenceChoiceCriteria,
	patdownEvidenceChoiceInstructions,
	splitPatdownEvidenceCandidates,
} from '#src/patdown-evidence-regions'
import { judgePatdownFileContents } from '#src/patdown-file-judgment'
import { patdownGlobExcludes, patdownGlobPatterns } from '#src/patdown-glob'
import { PatdownJudge, PatdownJudgeFailed, locatePatdownEvidence } from '#src/patdown-judge'
import {
	countPlannedPatdownJudgments,
	formatPatdownJudgmentBudgetExceeded,
	PatdownJudgmentBudgetExceeded,
	type PatdownJudgmentBudget,
} from '#src/patdown-judgment-budget'
import { selectPatdownRuleFiles, type PatdownLintFileSelection } from '#src/patdown-lint-files'
import { PatdownOutput, type PatdownLintEvidenceSpan } from '#src/patdown-output'
import { decodePatdownRuleYesThreshold } from '#src/patdown-yes-threshold-config'

/**
 * File contents held only while more than one rule still has to read them.
 *
 * Both execution loops below run at `concurrency: 1`, so a plain mutable map is enough; the
 * copy-on-write `Ref` this replaced copied every existing entry on every miss, which is quadratic
 * in the number of unique files.
 *
 * `remaining` is the number of planned reads left for each path, counted from the plans before any
 * judging starts. A file only one rule matches is never stored, and a file several rules match is
 * dropped after its last planned read — so a run holds the contents it is about to reuse rather
 * than every file it has ever opened.
 */
type PatdownFileContentsCache = {
	readonly contents: Map<string, string>
	readonly remaining: Map<string, number>
}

/** Count the planned reads per path, so the cache knows when a file is finished with. */
function makePatdownFileContentsCache(
	plans: ReadonlyArray<PatdownRulePlan>,
): PatdownFileContentsCache {
	const remaining = new Map<string, number>()

	for (const plan of plans) {
		for (const filePath of plan.files) {
			remaining.set(filePath, (remaining.get(filePath) ?? 0) + 1)
		}
	}

	return { contents: new Map<string, string>(), remaining }
}

/** Glob rule targets and keep files only. Effect FileSystem.glob also returns directories. */
function globPatdownRuleFiles(
	cwd: string,
	globs: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<string>, never, FileSystem.FileSystem> {
	return Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem
		const patterns = patdownGlobPatterns(globs)
		const matches: string[] = []

		for (const pattern of patterns) {
			const found = yield* fileSystem
				.glob(pattern, {
					exclude: patdownGlobExcludes,
					root: cwd,
				})
				.pipe(Effect.orElseSucceed((): string[] => []))

			for (const match of found) {
				const absolutePath = isAbsolute(match) ? match : resolve(cwd, match)
				const info = yield* fileSystem.stat(absolutePath).pipe(Effect.option)

				if (Option.isNone(info) || info.value.type !== 'File') continue

				matches.push(absolutePath)
			}
		}

		return [...new Set(matches)].toSorted()
	})
}

/**
 * Read a file at most once per run. A file matched by several rules was read once per rule, so a
 * tree linted against a pack of rules paid for the same bytes as many times as it had rules.
 */
function readPatdownFileContents(
	cache: PatdownFileContentsCache,
	filePath: string,
	relativePath: string,
): Effect.Effect<string, PatdownJudgeFailed, FileSystem.FileSystem> {
	return Effect.gen(function* () {
		// Spend one planned read whether it hits or misses; at zero nothing will ask again.
		const remaining = (cache.remaining.get(filePath) ?? 1) - 1
		cache.remaining.set(filePath, remaining)

		const cached = cache.contents.get(filePath)

		if (cached !== undefined) {
			if (remaining <= 0) cache.contents.delete(filePath)

			return cached
		}

		const fileSystem = yield* FileSystem.FileSystem

		const contents = yield* fileSystem.readFileString(filePath).pipe(
			Effect.mapError(
				() =>
					new PatdownJudgeFailed({
						message: `patdown: failed to read ${relativePath}`,
					}),
			),
		)

		if (remaining > 0) cache.contents.set(filePath, contents)

		return contents
	})
}

function lintPatdownRuleFile(
	rule: PatdownRule,
	filePath: string,
	options: {
		readonly cwd: string
		readonly verbose: boolean
		readonly yesThreshold: PatdownYesThreshold
		readonly cache: PatdownFileContentsCache
	},
): Effect.Effect<
	boolean,
	PatdownJudgeFailed,
	FileSystem.FileSystem | PatdownJudge | Path.Path | PatdownOutput
> {
	return Effect.gen(function* () {
		const path = yield* Path.Path
		const output = yield* PatdownOutput
		const relativePath = path.relative(options.cwd, filePath)

		const contents = yield* readPatdownFileContents(options.cache, filePath, relativePath)

		const judged = yield* judgePatdownFileContents(
			rule,
			relativePath,
			contents,
			options.yesThreshold,
		)

		let evidence: PatdownLintEvidenceSpan | undefined
		let elapsedMs = judged.elapsedMs

		if (judged.violated) {
			const evidenceStartedAt = yield* Clock.currentTimeMillis
			const candidates = splitPatdownEvidenceCandidates(contents)

			const candidatesById = new Map(
				candidates.map((candidate) => [
					candidate.id,
					{ startLine: candidate.startLine, endLine: candidate.endLine },
				]),
			)

			const located = yield* locatePatdownEvidence(
				patdownEvidenceChoiceInstructions(),
				formatPatdownEvidenceChoiceState({
					relativePath,
					ruleTitle: rule.patdownRuleTitle,
					ruleBody: rule.patdownRuleBody,
					violationProbability: judged.violationProbability,
					contents,
					candidates,
				}),
				patdownEvidenceChoiceCriteria(candidates),
				candidatesById,
			).pipe(Effect.catchTag('PatdownJudgeFailed', () => Effect.succeed(null)))

			const evidenceFinishedAt = yield* Clock.currentTimeMillis

			elapsedMs += Math.max(0, evidenceFinishedAt - evidenceStartedAt)

			if (located !== null) {
				evidence = {
					startLine: located.startLine,
					endLine: located.endLine,
					confidence: located.confidence,
				}
			}
		}

		const lintResult = { ...judged, elapsedMs }

		yield* output.writeLintResult(
			evidence === undefined ? lintResult : { ...lintResult, evidence },
			options.verbose,
		)

		return judged.violated
	})
}

type PatdownRulePlanOptions = {
	readonly cwd: string
	readonly defaultYesThreshold: PatdownYesThreshold
	readonly selection: PatdownLintFileSelection | null
}

/** One rule's resolved work: which files it will judge, and the cutoff it will judge them at. */
type PatdownRulePlan = {
	readonly rule: PatdownRule
	readonly files: ReadonlyArray<string>
	readonly yesThreshold: PatdownYesThreshold
}

/**
 * Resolve a rule's files and cutoff without calling the judge. Globbing every rule up front is what
 * makes the judgment count knowable before the run spends anything, and it moves an invalid
 * per-rule `yes-threshold:` to the same place.
 */
function planPatdownRule(
	rule: PatdownRule,
	options: PatdownRulePlanOptions,
): Effect.Effect<PatdownRulePlan, PatdownYesThresholdInvalid, FileSystem.FileSystem> {
	return Effect.gen(function* () {
		const files = selectPatdownRuleFiles(
			options.cwd,
			options.selection,
			rule.patdownRuleGlobs,
			options.selection === null
				? yield* globPatdownRuleFiles(options.cwd, rule.patdownRuleGlobs)
				: [],
		)

		const yesThreshold =
			rule.patdownRuleYesThreshold === undefined
				? options.defaultYesThreshold
				: yield* decodePatdownRuleYesThreshold(rule.patdownRuleYesThreshold, rule.patdownRuleTitle)

		return { rule, files, yesThreshold }
	})
}

function lintPatdownRulePlan(
	plan: PatdownRulePlan,
	options: {
		readonly cwd: string
		readonly verbose: boolean
		readonly selection: PatdownLintFileSelection | null
		readonly cache: PatdownFileContentsCache
	},
): Effect.Effect<
	boolean,
	PatdownJudgeFailed,
	FileSystem.FileSystem | PatdownJudge | Path.Path | PatdownOutput
> {
	return Effect.gen(function* () {
		const output = yield* PatdownOutput

		if (plan.files.length === 0) {
			if (options.selection === null) {
				yield* output.writeNoFilesMatched(plan.rule.patdownRuleTitle)
			}

			return false
		}

		yield* output.writeLintRuleStart(plan.rule.patdownRuleTitle, plan.files.length, options.verbose)

		const failures = yield* Effect.forEach(
			plan.files,
			(filePath) =>
				lintPatdownRuleFile(plan.rule, filePath, {
					cwd: options.cwd,
					verbose: options.verbose,
					yesThreshold: plan.yesThreshold,
					cache: options.cache,
				}),
			{ concurrency: 1 },
		)

		return failures.some((failed) => failed)
	})
}

/** Lint files matched by each rule's globs. A yes judgment means a violation. */
export function runPatdownLint(
	document: PatdownRulesDocument,
	verbose: boolean = false,
	yesThreshold: PatdownYesThreshold = defaultPatdownYesThreshold,
	scope: {
		readonly selection?: PatdownLintFileSelection | null
		readonly judgmentBudget?: PatdownJudgmentBudget
	} = {},
): Effect.Effect<
	{ readonly failed: boolean; readonly elapsedMs: number },
	PatdownJudgeFailed | PatdownYesThresholdInvalid | PatdownJudgmentBudgetExceeded,
	FileSystem.FileSystem | PatdownJudge | Path.Path | PatdownOutput
> {
	return Effect.gen(function* () {
		const path = yield* Path.Path
		const output = yield* PatdownOutput
		const cwd = path.resolve('.')
		const startedAt = yield* Clock.currentTimeMillis
		const selection = scope.selection ?? null
		const judgmentBudget = scope.judgmentBudget ?? null

		yield* output.writeLintStart(
			document.patdownRules.length,
			selection === null ? null : selection.relativePaths.length,
		)

		const plans = yield* Effect.forEach(
			document.patdownRules,
			(rule) =>
				planPatdownRule(rule, {
					cwd,
					defaultYesThreshold: yesThreshold,
					selection,
				}),
			{ concurrency: 1 },
		)

		if (judgmentBudget !== null) {
			const planned = countPlannedPatdownJudgments(plans.map((plan) => plan.files.length))

			if (planned > judgmentBudget) {
				return yield* new PatdownJudgmentBudgetExceeded({
					message: formatPatdownJudgmentBudgetExceeded(planned, judgmentBudget),
				})
			}
		}

		const cache = makePatdownFileContentsCache(plans)

		const failures = yield* Effect.forEach(
			plans,
			(plan) => lintPatdownRulePlan(plan, { cwd, verbose, selection, cache }),
			{ concurrency: 1 },
		)

		const finishedAt = yield* Clock.currentTimeMillis

		return {
			failed: failures.some((failed) => failed),
			elapsedMs: Math.max(0, finishedAt - startedAt),
		}
	})
}
