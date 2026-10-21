import { matchesGlob } from 'node:path'

/**
 * Paths skipped for every rule glob and every --files path. Build directories, their bare entries,
 * and common credential filenames. Credential paths are skipped so their contents are never posted
 * to the judge.
 */
export const patdownGlobExcludes = [
	'**/.git/**',
	'**/.git',
	'**/.turbo/**',
	'**/.turbo',
	'**/coverage/**',
	'**/coverage',
	'**/dist/**',
	'**/dist',
	'**/node_modules/**',
	'**/node_modules',
	'**/.env',
	'**/.env.*',
	'**/*.pem',
	'**/id_rsa',
	'**/id_rsa.*',
	'**/credentials.json',
	'**/secrets.yaml',
	'**/secrets.yml',
	'**/*.tfvars',
	'**/*.tfvars.json',
	'**/.npmrc',
	'**/.pypirc',
	'**/.pgpass',
	'**/.my.cnf',
	'**/*.p12',
	'**/*.pfx',
	'**/.git-credentials',
	'**/*.keystore',
	'**/*.jks',
] as const

/** Empty rule globs mean the whole tree. */
export function patdownGlobPatterns(globs: ReadonlyArray<string>): ReadonlyArray<string> {
	return globs.length === 0 ? ['**/*'] : globs
}

/** True when a cwd-relative path is under a skipped directory or matches a skipped credential file. */
export function patdownPathIsExcluded(relativePath: string): boolean {
	return patdownGlobExcludes.some((pattern) => matchesGlob(relativePath, pattern))
}

/** True when a cwd-relative path matches any rule glob after the empty-glob default. */
export function patdownPathMatchesRuleGlobs(
	relativePath: string,
	globs: ReadonlyArray<string>,
): boolean {
	return patdownGlobPatterns(globs).some((pattern) => matchesGlob(relativePath, pattern))
}
