import { Data, Effect, Option } from 'effect'

/** `--max-judgments` was not a usable cap. */
export class PatdownJudgmentBudgetInvalid extends Data.TaggedError('PatdownJudgmentBudgetInvalid')<{
	readonly message: string
}> {}

/** A run refused before its first judge call because the plan exceeds the cap. */
export class PatdownJudgmentBudgetExceeded extends Data.TaggedError(
	'PatdownJudgmentBudgetExceeded',
)<{
	readonly message: string
}> {}

/** Maximum file judgments allowed in one run. `null` means no cap. */
export type PatdownJudgmentBudget = number | null

/** Decode `--max-judgments`. Absent means no cap; a cap must be at least one. */
export function resolvePatdownJudgmentBudget(
	flag: Option.Option<number>,
): Effect.Effect<PatdownJudgmentBudget, PatdownJudgmentBudgetInvalid> {
	if (Option.isNone(flag)) return Effect.succeed(null)

	const value = flag.value

	if (!Number.isSafeInteger(value) || value < 1) {
		return Effect.fail(
			new PatdownJudgmentBudgetInvalid({
				message: `patdown: --max-judgments must be a whole number of at least 1, received ${String(value)}`,
			}),
		)
	}

	return Effect.succeed(value)
}

/** Judge calls a planned run will make, counted before it makes any of them. */
export function countPlannedPatdownJudgments(fileCounts: ReadonlyArray<number>): number {
	return fileCounts.reduce((total, count) => total + count, 0)
}

/**
 * Refusal message. Names the plan, the cap and the two ways out. A FAIL adds a second call to
 * locate the evidence, so the planned count is the floor of what the run would have cost.
 */
export function formatPatdownJudgmentBudgetExceeded(judgments: number, budget: number): string {
	const calls = judgments === 1 ? '1 file judgment' : `${String(judgments)} file judgments`

	return [
		`patdown: refusing to start: ${calls} planned, --max-judgments is ${String(budget)}.`,
		'Narrow the run with --files or --files-from, or raise the cap.',
	].join(' ')
}
