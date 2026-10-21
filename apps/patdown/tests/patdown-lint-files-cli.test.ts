import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { NodeServices } from '@effect/platform-node'
import { afterEach, describe, expect, it } from '@effect/vitest'
import { MarkdownPatdownRuleSourceLive } from '@patdown/rules'
import { Effect, Layer } from 'effect'
import { TestConsole } from 'effect/testing'

import { PatdownJudge } from '#src/patdown-judge'
import { PatdownOutputLive } from '#src/patdown-output'
import { runPatdownCli } from '#src/run-patdown-cli'

const directories: string[] = []

const originalCwd = process.cwd()

afterEach(() => {
	process.chdir(originalCwd)

	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function projectDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), 'patdown-files-cli-'))
	directories.push(directory)

	return directory
}

const outputHarness = Layer.mergeAll(PatdownOutputLive, TestConsole.layer, NodeServices.layer)

describe('lint file flags', () => {
	it.effect('intersects --files with rule globs and skips unmatched rules quietly', () =>
		Effect.gen(function* () {
			const root = projectDirectory()

			writeFileSync(
				join(root, 'AGENTS.PATDOWN.md'),
				[
					'# Markdown only',
					'globs: **/*.md',
					'',
					'Use sentence case.',
					'',
					'# TypeScript only',
					'globs: **/*.ts',
					'',
					'Prefer explicit actors.',
					'',
				].join('\n'),
			)
			writeFileSync(join(root, 'README.md'), '# Hello World\n')
			writeFileSync(join(root, 'service.ts'), 'export const x = 1\n')
			process.chdir(root)

			const asked: string[] = []

			const judge = Layer.succeed(PatdownJudge, {
				ask: (question, text) =>
					Effect.sync(() => {
						asked.push(`${question}\n${text}`)

						return { yesProbability: 0.1 }
					}),
			})

			yield* runPatdownCli(MarkdownPatdownRuleSourceLive, ['--files', 'service.ts'], judge)

			const lines = yield* TestConsole.logLines

			expect(asked).toHaveLength(1)
			expect(asked[0]).toContain('path: service.ts')
			expect(lines.join('\n')).toContain('patdown: linting 1 file against 2 rules')
			expect(lines.join('\n')).not.toContain('no files matched')
			expect(lines.join('\n')).toContain('PASS service.ts: TypeScript only')
			expect(lines.join('\n')).not.toContain('README.md')
		}).pipe(Effect.provide(outputHarness)),
	)

	it.effect('expands a --files directory before intersecting rule globs', () =>
		Effect.gen(function* () {
			const root = projectDirectory()
			const src = join(root, 'src')

			mkdirSync(src, { recursive: true })
			writeFileSync(
				join(root, 'AGENTS.PATDOWN.md'),
				['# TypeScript only', 'globs: **/*.ts', '', 'Prefer explicit actors.', ''].join('\n'),
			)
			writeFileSync(join(root, 'README.md'), '# Hello World\n')
			writeFileSync(join(src, 'service.ts'), 'export const x = 1\n')
			process.chdir(root)

			const asked: string[] = []

			const judge = Layer.succeed(PatdownJudge, {
				ask: (question, text) =>
					Effect.sync(() => {
						asked.push(`${question}\n${text}`)

						return { yesProbability: 0.1 }
					}),
			})

			yield* runPatdownCli(MarkdownPatdownRuleSourceLive, ['--files', 'src'], judge)

			const lines = yield* TestConsole.logLines

			expect(asked).toHaveLength(1)
			expect(asked[0]).toContain('path: src/service.ts')
			expect(lines.join('\n')).toContain('patdown: linting 1 file against 1 rule')
			expect(lines.join('\n')).toContain('PASS src/service.ts: TypeScript only')
		}).pipe(Effect.provide(outputHarness)),
	)
})

describe('empty rule globs', () => {
	it.effect('lints files only and skips credential paths for every selection mode', () =>
		Effect.gen(function* () {
			const root = projectDirectory()

			mkdirSync(join(root, 'src'), { recursive: true })
			mkdirSync(join(root, 'dist'), { recursive: true })
			writeFileSync(
				join(root, 'AGENTS.PATDOWN.md'),
				['# Whole tree', '', 'Prefer explicit actors.', ''].join('\n'),
			)
			writeFileSync(join(root, 'README.md'), '# Hello World\n')
			writeFileSync(join(root, 'src/service.ts'), 'export const x = 1\n')
			writeFileSync(join(root, 'dist/bundle.js'), 'export {}\n')
			writeFileSync(join(root, '.env'), 'SECRET=1\n')
			writeFileSync(join(root, 'id_rsa'), 'private-key\n')

			const credentialPaths = [
				'prod.tfvars',
				'prod.tfvars.json',
				'.npmrc',
				'.pypirc',
				'.pgpass',
				'.my.cnf',
				'client.p12',
				'client.pfx',
				'.git-credentials',
				'release.keystore',
				'release.jks',
			].flatMap((filename) => [filename, `src/${filename}`])

			for (const relativePath of credentialPaths) {
				writeFileSync(join(root, relativePath), `CANARY-CREDENTIAL:${relativePath}\n`)
			}

			const selectionPaths = [
				'AGENTS.PATDOWN.md',
				'README.md',
				'src/service.ts',
				'dist/bundle.js',
				'.env',
				'id_rsa',
				...credentialPaths,
			]

			writeFileSync(join(root, 'changed.txt'), selectionPaths.join('\n'))
			process.chdir(root)

			for (const args of [
				[],
				['--files', '**/*'],
				['--files', '.'],
				selectionPaths.flatMap((path) => ['--files', path]),
				['--files-from', 'changed.txt'],
			]) {
				const asked: string[] = []

				const judge = Layer.succeed(PatdownJudge, {
					ask: (question, text) =>
						Effect.sync(() => {
							asked.push(`${question}\n${text}`)

							return { yesProbability: 0.1 }
						}),
				})

				yield* runPatdownCli(MarkdownPatdownRuleSourceLive, args, judge)

				const askedText = asked.join('\n')
				const lines = yield* TestConsole.logLines

				expect(askedText).toContain('path: README.md')
				expect(askedText).toContain('path: src/service.ts')
				expect(askedText).toContain('path: AGENTS.PATDOWN.md')
				expect(askedText).not.toContain('path: src\n')
				expect(askedText).not.toContain('path: dist')
				expect(askedText).not.toContain('SECRET=1')
				expect(askedText).not.toContain('private-key')
				expect(askedText).not.toContain('CANARY-CREDENTIAL:')
				expect(lines.join('\n')).toContain('patdown: passed')
			}
		}).pipe(Effect.provide(outputHarness)),
	)
})
