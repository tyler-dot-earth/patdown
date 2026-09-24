import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { NodeServices } from '@effect/platform-node'
import { afterEach, describe, expect, it } from '@effect/vitest'
import { MarkdownPatdownRuleSourceLive, PatdownRuleSource } from '@patdown/rules'
import { Effect, Layer, Option } from 'effect'
import { TestConsole } from 'effect/testing'

import { PatdownJudge } from '#src/patdown-judge'
import {
	countPlannedPatdownJudgments,
	formatPatdownJudgmentBudgetExceeded,
	resolvePatdownJudgmentBudget,
} from '#src/patdown-judgment-budget'
import { PatdownOutputLive } from '#src/patdown-output'
import type { PatdownRuleSourceLayer } from '#src/patdown-rule-source-adapter'
import { runPatdownCli } from '#src/run-patdown-cli'

const directories: string[] = []

const originalCwd = process.cwd()

const originalExitCode = process.exitCode

afterEach(() => {
	process.chdir(originalCwd)
	process.exitCode = originalExitCode

	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function projectDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), 'patdown-budget-'))
	directories.push(directory)

	return directory
}

/** Two rules over the same two files: four judgments, and each file matched twice. */
function twoRulesOverTwoFiles(): string {
	const root = projectDirectory()

	writeFileSync(
		join(root, 'AGENTS.PATDOWN.md'),
		[
			'# Explicit actors',
			'globs: **/*.ts',
			'',
			'Prefer explicit actors.',
			'',
			'# Sentence case',
			'globs: **/*.ts',
			'',
			'Use sentence case.',
			'',
		].join('\n'),
	)
	writeFileSync(join(root, 'service.ts'), 'export const x = 1\n')
	writeFileSync(join(root, 'client.ts'), 'export const y = 2\n')
	process.chdir(root)

	return root
}

/**
 * Two rules over the same two files, the cutoff on the second one. The markdown parser rejects an
 * unusable `yes-threshold:` while it reads the file, so a fixture cannot say anything about when
 * lint spends: the rules have to arrive already parsed for planning to be what refuses them.
 */
function rulesWithSecondRuleCutoff(yesThreshold: number): PatdownRuleSourceLayer {
	return Layer.succeed(PatdownRuleSource, {
		loadPatdownRules: () =>
			Effect.succeed({
				patdownRules: [
					{
						patdownRuleBody: 'Prefer explicit actors.',
						patdownRuleGlobs: ['**/*.ts'],
						patdownRuleTitle: 'Explicit actors',
					},
					{
						patdownRuleBody: 'Use sentence case.',
						patdownRuleGlobs: ['**/*.ts'],
						patdownRuleTitle: 'Sentence case',
						patdownRuleYesThreshold: yesThreshold,
					},
				],
				patdownRulesFilePath: join(process.cwd(), 'AGENTS.PATDOWN.md'),
			}),
	})
}

const outputHarness = Layer.mergeAll(PatdownOutputLive, TestConsole.layer, NodeServices.layer)

describe('judgment budget', () => {
	it('counts the planned judgments across rules', () => {
		expect(countPlannedPatdownJudgments([])).toBe(0)
		expect(countPlannedPatdownJudgments([2, 2])).toBe(4)
		expect(countPlannedPatdownJudgments([3, 0, 1])).toBe(4)
	})

	it.effect('accepts an absent flag as no cap', () =>
		Effect.gen(function* () {
			expect(yield* resolvePatdownJudgmentBudget(Option.none())).toBeNull()
			expect(yield* resolvePatdownJudgmentBudget(Option.some(7))).toBe(7)
		}),
	)

	it.effect('rejects a cap below one', () =>
		Effect.gen(function* () {
			const failure = yield* resolvePatdownJudgmentBudget(Option.some(0)).pipe(Effect.flip)

			expect(failure.message).toContain('--max-judgments must be a whole number of at least 1')
			expect(failure.message).toContain('received 0')
		}),
	)

	it('names the plan, the cap and the way out', () => {
		expect(formatPatdownJudgmentBudgetExceeded(4, 2)).toBe(
			'patdown: refusing to start: 4 file judgments planned, --max-judgments is 2.' +
				' Narrow the run with --files or --files-from, or raise the cap.',
		)
		expect(formatPatdownJudgmentBudgetExceeded(1, 1)).toContain('1 file judgment planned')
	})

	it.effect('refuses the run before asking the judge anything', () =>
		Effect.gen(function* () {
			twoRulesOverTwoFiles()

			const asked: string[] = []

			const judge = Layer.succeed(PatdownJudge, {
				ask: (_question, text) =>
					Effect.sync(() => {
						asked.push(text)

						return { yesProbability: 0.1 }
					}),
			})

			yield* runPatdownCli(MarkdownPatdownRuleSourceLive, ['--max-judgments', '3'], judge)

			expect(asked).toHaveLength(0)
			expect(process.exitCode).toBe(1)
		}).pipe(Effect.provide(outputHarness)),
	)

	it.effect('runs when the plan fits inside the cap', () =>
		Effect.gen(function* () {
			twoRulesOverTwoFiles()

			const asked: string[] = []

			const judge = Layer.succeed(PatdownJudge, {
				ask: (_question, text) =>
					Effect.sync(() => {
						asked.push(text)

						return { yesProbability: 0.1 }
					}),
			})

			yield* runPatdownCli(MarkdownPatdownRuleSourceLive, ['--max-judgments', '4'], judge)

			expect(asked).toHaveLength(4)
			expect(process.exitCode).not.toBe(1)
		}).pipe(Effect.provide(outputHarness)),
	)

	it.effect('every rule judges the same snapshot of a file', () =>
		Effect.gen(function* () {
			const root = twoRulesOverTwoFiles()

			const asked: string[] = []

			// The file is removed while the first rule is being judged. Without a per-run read, the
			// second rule would fail to read a file the run had already accepted.
			const judge = Layer.succeed(PatdownJudge, {
				ask: (_question, text) =>
					Effect.sync(() => {
						asked.push(text)

						if (asked.length === 1) unlinkSync(join(root, 'client.ts'))

						return { yesProbability: 0.1 }
					}),
			})

			yield* runPatdownCli(MarkdownPatdownRuleSourceLive, [], judge)

			const clientJudgments = asked.filter((text) => text.startsWith('path: client.ts'))

			expect(clientJudgments).toHaveLength(2)
			expect(clientJudgments[0]).toBe(clientJudgments[1])
			expect(process.exitCode).not.toBe(1)
		}).pipe(Effect.provide(outputHarness)),
	)
})

describe('judgment budget and the rest of the run', () => {
	it.effect('a narrowed selection fits a cap the whole tree does not', () =>
		Effect.gen(function* () {
			twoRulesOverTwoFiles()

			const asked: string[] = []

			const judge = Layer.succeed(PatdownJudge, {
				ask: (_question, text) =>
					Effect.sync(() => {
						asked.push(text)

						return { yesProbability: 0.1 }
					}),
			})

			// Four judgments planned over the tree, two over one file. The cap counts what the
			// selection leaves, not what the globs would have matched.
			yield* runPatdownCli(MarkdownPatdownRuleSourceLive, ['--max-judgments', '2'], judge)

			expect(asked).toHaveLength(0)
			expect(process.exitCode).toBe(1)

			process.exitCode = originalExitCode
			asked.length = 0

			yield* runPatdownCli(
				MarkdownPatdownRuleSourceLive,
				['--max-judgments', '2', '--files', 'service.ts'],
				judge,
			)

			expect(asked).toHaveLength(2)
			expect(asked.every((text) => text.startsWith('path: service.ts'))).toBe(true)
			expect(process.exitCode).not.toBe(1)
		}).pipe(Effect.provide(outputHarness)),
	)

	it.effect('a later rule with an unusable cutoff spends nothing on the earlier ones', () =>
		Effect.gen(function* () {
			twoRulesOverTwoFiles()

			const asked: string[] = []

			const judge = Layer.succeed(PatdownJudge, {
				ask: (_question, text) =>
					Effect.sync(() => {
						asked.push(text)

						return { yesProbability: 0.1 }
					}),
			})

			// Planning resolves every rule's cutoff before the first judge call, so the second
			// rule's cutoff of 1 is rejected before the first rule is judged. The old order judged
			// rule one, then failed. This pins the change.
			yield* runPatdownCli(rulesWithSecondRuleCutoff(1), [], judge)

			expect(asked).toHaveLength(0)
			expect(process.exitCode).toBe(1)

			process.exitCode = originalExitCode
			asked.length = 0

			// And the run is not refused for some other reason: the same two rules with a usable
			// cutoff on the second one judge both files against both rules.
			yield* runPatdownCli(rulesWithSecondRuleCutoff(0.9), [], judge)

			expect(asked).toHaveLength(4)
			expect(process.exitCode).not.toBe(1)
		}).pipe(Effect.provide(outputHarness)),
	)

	it.effect('evidence calls are extra requests the cap does not count', () =>
		Effect.gen(function* () {
			twoRulesOverTwoFiles()

			const judgments: string[] = []
			const evidence: string[] = []

			const judge = Layer.succeed(PatdownJudge, {
				ask: (_question, text) =>
					Effect.sync(() => {
						judgments.push(text)

						return { yesProbability: 0.99 }
					}),
				locateEvidence: (_question, text) =>
					Effect.sync(() => {
						evidence.push(text)

						return null
					}),
			})

			// Four planned judgments, a cap of exactly four, and every one of them a violation.
			// The run is accepted and makes four more requests than the cap names.
			yield* runPatdownCli(MarkdownPatdownRuleSourceLive, ['--max-judgments', '4'], judge)

			expect(judgments).toHaveLength(4)
			expect(evidence).toHaveLength(4)
			expect(process.exitCode).toBe(1)
		}).pipe(Effect.provide(outputHarness)),
	)
})
