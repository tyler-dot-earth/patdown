export { patdownCommand, makePatdownCommand } from '#src/cli'

export { PatdownOutput, PatdownOutputLive, type PatdownLintResult } from '#src/patdown-output'

export {
	makePatdownGitHubActionsOutputLive,
	PatdownGitHubActionsOutputLive,
} from '#src/patdown-github-actions-output'

export {
	formatPatdownGitHubActionsAnnotations,
	formatPatdownGitHubActionsSummary,
	formatPatdownRuleGuidance,
	patdownLintResultIsNearMiss,
} from '#src/patdown-github-actions-summary'

export {
	patdownGitHubActionsIsEnabled,
	readPatdownGitHubStepSummaryPath,
} from '#src/patdown-github-actions-env'

export {
	judgePatdownFileContents,
	judgePatdownMatchingRules,
	patdownFileState,
	patdownRuleAppliesToPath,
	patdownViolationInstructions,
} from '#src/patdown-file-judgment'

export { patdownPathIsExcluded, patdownPathMatchesRuleGlobs } from '#src/patdown-glob'

export type { PatdownLintFileSelection } from '#src/patdown-lint-files'

export {
	loadConfiguredPatdownRules,
	type PatdownRuleSourceLayer,
} from '#src/patdown-rule-source-adapter'

export { runPatdownCli } from '#src/run-patdown-cli'

export { resolvePatdownYesThreshold } from '#src/patdown-yes-threshold-config'

export {
	PatdownJudgmentBudgetExceeded,
	PatdownJudgmentBudgetInvalid,
	resolvePatdownJudgmentBudget,
	type PatdownJudgmentBudget,
} from '#src/patdown-judgment-budget'

export {
	PatdownJudge,
	PatdownJudgeFailed,
	PatdownJudgmentSchema,
	askPatdownJudge,
	locatePatdownEvidence,
	patdownJudgmentIsYes,
	patdownYesThreshold,
	type PatdownEvidenceChoice,
	type PatdownEvidenceLocation,
	type PatdownJudgment,
	type PatdownTimedJudgment,
} from '#src/patdown-judge'

export {
	defaultPatdownGitHubAnnotationLevel,
	defaultPatdownYesThreshold,
	decodePatdownGitHubAnnotationLevel,
	decodePatdownYesThreshold,
	PatdownGitHubAnnotationInvalid,
	PatdownYesThresholdInvalid,
	resolvePatdownGitHubAnnotationLevel,
	type PatdownGitHubAnnotationLevel,
	type PatdownYesThreshold,
} from '@patdown/rules'

export { TypeSafeJudgeLive } from '#src/typesafe-judge'
