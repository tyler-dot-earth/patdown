import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, matchesGlob, relative, resolve, sep } from 'node:path'

/** Paths skipped the same way as the CLI. Keep in sync with apps/patdown/src/patdown-glob.ts. */
const patdownGlobExcludes = [
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
]

/** Internal deadline for the Claude PreToolUse judge, under the hook's 120s timeout. */
export const patdownClaudeJudgeTimeoutMs = 90_000

function toPosixRelative(from, to) {
	return relative(from, to).split(sep).join('/')
}

/**
 * Resolve cwd, then require that a candidate path stays under it after symlink resolution. Missing
 * leaf paths walk up to the nearest existing parent before comparing.
 */
export function resolvePathInsideCwd(cwd, absolutePath) {
	const resolvedCwdPath = resolve(cwd)

	if (!existsSync(resolvedCwdPath)) return null

	const resolvedCwd = realpathSync(resolvedCwdPath)
	let probe = resolve(absolutePath)

	while (!existsSync(probe)) {
		const parent = resolve(probe, '..')

		if (parent === probe) return null

		probe = parent
	}

	const resolvedTarget = realpathSync(probe)
	const relativePath = toPosixRelative(resolvedCwd, resolvedTarget)

	if (relativePath === '..' || relativePath.startsWith('../')) {
		return null
	}

	return { resolvedCwd, resolvedTarget, relativePath }
}

/**
 * Cwd-relative POSIX path, or null when the tool path is outside cwd / excluded / escapes via
 * symlink.
 */
export function patdownRelativeToolPath(cwd, rawPath) {
	const trimmed = String(rawPath ?? '').trim()

	if (trimmed.length === 0) return null

	const absolutePath = isAbsolute(trimmed) ? resolve(trimmed) : resolve(cwd, trimmed)
	const lexicalRelative = toPosixRelative(resolve(cwd), absolutePath)

	if (lexicalRelative === '' || lexicalRelative === '..' || lexicalRelative.startsWith('../')) {
		return null
	}

	if (patdownGlobExcludes.some((pattern) => matchesGlob(lexicalRelative, pattern))) {
		return null
	}

	if (resolvePathInsideCwd(cwd, absolutePath) === null) {
		return null
	}

	return lexicalRelative
}

/** Apply one Claude Edit replacement. replace_all replaces every non-overlapping occurrence. */
export function applyClaudeEdit(contents, oldString, newString, replaceAll = false) {
	if (oldString.length === 0) return null

	if (!replaceAll) {
		const index = contents.indexOf(oldString)

		if (index === -1) return null

		const second = contents.indexOf(oldString, index + oldString.length)

		if (second !== -1) return null

		return contents.slice(0, index) + newString + contents.slice(index + oldString.length)
	}

	if (!contents.includes(oldString)) return null

	return contents.split(oldString).join(newString)
}

/** Reconstruct the file Claude is about to write, or null to skip judging. */
export function proposedClaudeToolFile(cwd, toolName, toolInput, readFile) {
	const relativePath = patdownRelativeToolPath(cwd, toolInput?.file_path)

	if (relativePath === null) return null

	if (toolName === 'Write') {
		if (typeof toolInput?.content !== 'string') return null

		return { relativePath, contents: toolInput.content }
	}

	if (toolName === 'Edit') {
		if (typeof toolInput?.old_string !== 'string' || typeof toolInput?.new_string !== 'string') {
			return null
		}

		let existing

		try {
			existing = readFile(relativePath)
		} catch {
			return null
		}

		const contents = applyClaudeEdit(
			existing,
			toolInput.old_string,
			toolInput.new_string,
			toolInput.replace_all === true,
		)

		if (contents === null) return null

		return { relativePath, contents }
	}

	return null
}

/** Read a cwd-relative path only when the resolved target stays under cwd. */
export function readFileInsideCwd(cwd, relativePath) {
	const absolutePath = resolve(cwd, relativePath)
	const resolved = resolvePathInsideCwd(cwd, absolutePath)

	if (resolved === null) {
		throw new Error(`patdown: path escapes workspace: ${relativePath}`)
	}

	if (lstatSync(absolutePath).isSymbolicLink()) {
		const linkRelative = toPosixRelative(resolved.resolvedCwd, resolved.resolvedTarget)

		if (linkRelative === '..' || linkRelative.startsWith('../')) {
			throw new Error(`patdown: symlink escapes workspace: ${relativePath}`)
		}
	}

	return readFileSync(absolutePath, 'utf8')
}
