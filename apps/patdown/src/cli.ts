import {
	PatdownGitHubAnnotationInvalid,
	PatdownRuleSource,
	PatdownRulesFileMissing,
	PatdownRulesReadFailed,
	PatdownRulesLoadFailed,
	PatdownYesThresholdInvalid,
} from '@patdown/rules'
import { Effect, FileSystem, Option, Path, Stdio } from 'effect'
import { Argument, Command, Flag } from 'effect/unstable/cli'

import { patdownCliVersion } from '#src/patdown-cli-version'
import { formatPatdownDoctorReport, runPatdownDoctor } from '#src/patdown-doctor'
import { PatdownJudge, PatdownJudgeFailed, askPatdownJudge } from '#src/patdown-judge'
import {
	PatdownJudgmentBudgetExceeded,
	PatdownJudgmentBudgetInvalid,
	resolvePatdownJudgmentBudget,
} from '#src/patdown-judgment-budget'
import { runPatdownLint } from '#src/patdown-lint'
import { resolvePatdownLintFileSelection } from '#src/patdown-lint-files'
import { PatdownOutput } from '#src/patdown-output'
import { readPatdownQuestionInput } from '#src/patdown-question-input'
import { loadConfiguredPatdownRules } from '#src/patdown-rule-source-adapter'
import { resolvePatdownYesThreshold } from '#src/patdown-yes-threshold-config'

const failPatdown = (message: string): Effect.Effect<void> =>
	Effect.sync(() => {
		process.exitCode = 1
		process.stderr.write(`${message}\n`)
	})

const rulesFileFlag = Flag.optional(Flag.String('rules')).pipe(
	Flag.withDescription(
		'Rules markdown file or directory of rule files. Skips the AGENTS.PATDOWN.md walk',
	),
)

const verboseFlag = Flag.Boolean('verbose').pipe(
	Flag.withDefault(false),
	Flag.withDescription(
		'Show estimated yes probabilities, the decision cutoff, and elapsed judge time',
	),
)

const adapterFlag = Flag.optional(Flag.String('adapter')).pipe(
	Flag.withDescription('Module exporting PatdownRuleSourceLive, replacing markdown rule parsing'),
)

const yesThresholdFlag = Flag.optional(Flag.Finite('yes-threshold')).pipe(
	Flag.withDescription('Minimum exclusive P(yes) for yes; default 0.85, overridable per rule'),
)

const maxJudgmentsFlag = Flag.optional(Flag.Int('max-judgments')).pipe(
	Flag.withDescription(
		'Refuse to start if more than this many file judgments are planned; default is no cap',
	),
)

const filesFlag = Flag.String('files').pipe(
	Flag.between(0, 10_000),
	Flag.withDescription(
		'Restrict lint to these files, directories, or globs; directories expand; intersects each rule glob',
	),
)

const filesFromFlag = Flag.optional(Flag.String('files-from')).pipe(
	Flag.withDescription(
		'Newline-separated files, directories, or globs to lint; use - for stdin; intersects each rule glob',
	),
)

const noGitHubFlag = Flag.Boolean('no-github').pipe(
	Flag.withDefault(false),
	Flag.withDescription('Disable GitHub Actions summary and annotations'),
)

const githubAnnotationFlag = Flag.optional(Flag.String('github-annotation')).pipe(
	Flag.withDescription(
		'GitHub Actions FAIL annotation level: error, warning, or notice; overridable per rule',
	),
)

type PatdownLintServices =
	| FileSystem.FileSystem
	| Stdio.Stdio
	| PatdownJudge
	| Path.Path
	| PatdownOutput
	| PatdownRuleSource

function finishPatdownLint(
	failed: boolean,
	verbose: boolean,
	elapsedMs: number,
): Effect.Effect<void, never, PatdownOutput> {
	return Effect.gen(function* () {
		const output = yield* PatdownOutput

		if (failed) {
			yield* output.writeLintFailed(verbose ? elapsedMs : undefined)
			yield* Effect.sync(() => {
				process.exitCode = 1
			})

			return
		}

		yield* output.writeLintOk(verbose ? elapsedMs : undefined)
	})
}

function makePatdownRulesCommand(
	discoverAdapters: boolean,
): Command.Command<'rules', never, object, never, PatdownLintServices> {
	return Command.make(
		'rules',
		{ adapter: adapterFlag, rules: rulesFileFlag },
		({
			rules,
			adapter,
		}): Effect.Effect<
			void,
			never,
			FileSystem.FileSystem | Path.Path | PatdownOutput | PatdownRuleSource
		> =>
			Effect.gen(function* () {
				const patdownRuleSource = yield* PatdownRuleSource
				const output = yield* PatdownOutput

				const document = yield* discoverAdapters
					? loadConfiguredPatdownRules(adapter, rules)
					: patdownRuleSource.loadPatdownRules(rules)

				yield* output.writeRulesDocument(document)
			}).pipe(
				Effect.catchTags({
					PatdownRulesFileMissing: (error: PatdownRulesFileMissing) => failPatdown(error.message),
					PatdownRulesReadFailed: (error: PatdownRulesReadFailed) => failPatdown(error.message),
					PatdownRulesLoadFailed: (error: PatdownRulesLoadFailed) => failPatdown(error.message),
					PatdownYesThresholdInvalid: (error: PatdownYesThresholdInvalid) =>
						failPatdown(error.message),
					PatdownGitHubAnnotationInvalid: (error: PatdownGitHubAnnotationInvalid) =>
						failPatdown(error.message),
				}),
			),
	).pipe(Command.withDescription('Load and print patdown rules'))
}

function makePatdownDoctorCommand(): Command.Command<
	'doctor',
	never,
	object,
	never,
	PatdownLintServices
> {
	return Command.make('doctor', {}, (): Effect.Effect<void, never, PatdownLintServices> =>
		Effect.gen(function* () {
			const report = yield* runPatdownDoctor(patdownCliVersion)

			yield* Effect.sync(() => {
				process.stdout.write(`${formatPatdownDoctorReport(report)}\n`)

				if (report.failed) process.exitCode = 1
			})
		}).pipe(
			Effect.catch((error) => {
				const message = error instanceof Error ? error.message : String(error)

				return failPatdown(message)
			}),
		),
	).pipe(
		Command.withDescription(
			'Check rule discovery and TYPESAFE_API_KEY in this process without calling the judge',
		),
	)
}

function makePatdownAskCommand(): Command.Command<
	'ask',
	never,
	object,
	never,
	PatdownLintServices
> {
	return Command.make(
		'ask',
		{
			question: Argument.String('question'),
			verbose: verboseFlag,
			yesThreshold: yesThresholdFlag,
			inputText: Flag.optional(Flag.String('input-text')).pipe(
				Flag.withDescription('Text to evaluate'),
			),
			stdin: Flag.Boolean('stdin').pipe(
				Flag.withDefault(false),
				Flag.withDescription('Read UTF-8 text from piped or redirected stdin'),
			),
		},
		({
			question,
			inputText,
			stdin,
			verbose,
			yesThreshold,
		}): Effect.Effect<
			void,
			never,
			PatdownJudge | PatdownOutput | Stdio.Stdio | FileSystem.FileSystem
		> =>
			Effect.gen(function* () {
				const output = yield* PatdownOutput
				const text = yield* readPatdownQuestionInput(inputText, stdin)
				const cutoff = yield* resolvePatdownYesThreshold(yesThreshold)
				const timed = yield* askPatdownJudge(question, text)

				yield* output.writeAnswer(timed.judgment, verbose, cutoff, timed.elapsedMs)
			}).pipe(
				Effect.catchTags({
					PatdownJudgeFailed: (error: PatdownJudgeFailed) => failPatdown(error.message),
					PatdownYesThresholdInvalid: (error: PatdownYesThresholdInvalid) =>
						failPatdown(error.message),
				}),
			),
	).pipe(Command.withDescription('Ask a yes/no question about text'))
}

function runPatdownRootLint(
	discoverAdapters: boolean,
	options: {
		readonly rules: Option.Option<string>
		readonly adapter: Option.Option<string>
		readonly verbose: boolean
		readonly yesThreshold: Option.Option<number>
		readonly files: ReadonlyArray<string>
		readonly filesFrom: Option.Option<string>
		readonly maxJudgments: Option.Option<number>
	},
): Effect.Effect<void, never, PatdownLintServices> {
	return Effect.gen(function* () {
		const patdownRuleSource = yield* PatdownRuleSource
		const path = yield* Path.Path
		const cutoff = yield* resolvePatdownYesThreshold(options.yesThreshold)
		const judgmentBudget = yield* resolvePatdownJudgmentBudget(options.maxJudgments)
		const cwd = path.resolve('.')
		const selection = yield* resolvePatdownLintFileSelection(cwd, options.files, options.filesFrom)

		const document = yield* discoverAdapters
			? loadConfiguredPatdownRules(options.adapter, options.rules)
			: patdownRuleSource.loadPatdownRules(options.rules)

		const linted = yield* runPatdownLint(document, options.verbose, cutoff, {
			selection,
			judgmentBudget,
		})

		yield* finishPatdownLint(linted.failed, options.verbose, linted.elapsedMs)
	}).pipe(
		Effect.catchTags({
			PatdownRulesLoadFailed: (error: PatdownRulesLoadFailed) => failPatdown(error.message),
			PatdownJudgeFailed: (error: PatdownJudgeFailed) => failPatdown(error.message),
			PatdownYesThresholdInvalid: (error: PatdownYesThresholdInvalid) => failPatdown(error.message),
			PatdownJudgmentBudgetInvalid: (error: PatdownJudgmentBudgetInvalid) =>
				failPatdown(error.message),
			PatdownJudgmentBudgetExceeded: (error: PatdownJudgmentBudgetExceeded) =>
				failPatdown(error.message),
			PatdownGitHubAnnotationInvalid: (error: PatdownGitHubAnnotationInvalid) =>
				failPatdown(error.message),
			PatdownRulesFileMissing: (error: PatdownRulesFileMissing) => failPatdown(error.message),
			PatdownRulesReadFailed: (error: PatdownRulesReadFailed) => failPatdown(error.message),
		}),
	)
}

/** Builds commands with optional adapter discovery for embedded callers. */
export function makePatdownCommand(
	discoverAdapters: boolean = true,
): Command.Command<'patdown', never, object, never, PatdownLintServices> {
	const rulesCommand = makePatdownRulesCommand(discoverAdapters)
	const askCommand = makePatdownAskCommand()
	const doctorCommand = makePatdownDoctorCommand()

	return Command.make(
		'patdown',
		{
			adapter: adapterFlag,
			files: filesFlag,
			filesFrom: filesFromFlag,
			githubAnnotation: githubAnnotationFlag,
			maxJudgments: maxJudgmentsFlag,
			noGitHub: noGitHubFlag,
			rules: rulesFileFlag,
			verbose: verboseFlag,
			yesThreshold: yesThresholdFlag,
		},
		({
			rules,
			adapter,
			verbose,
			yesThreshold,
			files,
			filesFrom,
			maxJudgments,
			githubAnnotation: _githubAnnotation,
			noGitHub: _noGitHub,
		}) =>
			runPatdownRootLint(discoverAdapters, {
				rules,
				adapter,
				verbose,
				yesThreshold,
				files,
				filesFrom,
				maxJudgments,
			}),
	).pipe(
		Command.withDescription('Lint a tree against fuzzy markdown rules'),
		Command.withShortDescription('Patdown CLI'),
		Command.withSubcommands([askCommand, doctorCommand, rulesCommand]),
	)
}

/** Default commands use explicit or package.json adapter discovery. */
export const patdownCommand = makePatdownCommand()
