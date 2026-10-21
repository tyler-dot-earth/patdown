import { describe, expect, it } from '@effect/vitest'

import { patdownPathIsExcluded } from '#src/patdown-glob'

describe('patdown path excludes', () => {
	it('skips build directories and their bare entries', () => {
		expect(patdownPathIsExcluded('dist')).toBe(true)
		expect(patdownPathIsExcluded('dist/bundle.js')).toBe(true)
		expect(patdownPathIsExcluded('node_modules')).toBe(true)
		expect(patdownPathIsExcluded('node_modules/pkg/index.js')).toBe(true)
		expect(patdownPathIsExcluded('coverage')).toBe(true)
		expect(patdownPathIsExcluded('.git')).toBe(true)
		expect(patdownPathIsExcluded('.turbo')).toBe(true)
		expect(patdownPathIsExcluded('src')).toBe(false)
		expect(patdownPathIsExcluded('src/cli.ts')).toBe(false)
	})

	it.each([
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
	])('skips credential file %s at the root and under nested paths', (filename) => {
		expect(patdownPathIsExcluded(filename)).toBe(true)
		expect(patdownPathIsExcluded(`apps/api/${filename}`)).toBe(true)
	})

	it.each(['main.tf', 'prod.tfvars.example', 'registry.npmrc', 'signing.key'])(
		'keeps file %s outside the credential skip list',
		(filename) => {
			expect(patdownPathIsExcluded(filename)).toBe(false)
			expect(patdownPathIsExcluded(`apps/api/${filename}`)).toBe(false)
		},
	)

	it('skips common credential filenames, including under nested paths', () => {
		expect(patdownPathIsExcluded('.env')).toBe(true)
		expect(patdownPathIsExcluded('.env.local')).toBe(true)
		expect(patdownPathIsExcluded('apps/api/.env')).toBe(true)
		expect(patdownPathIsExcluded('id_rsa')).toBe(true)
		expect(patdownPathIsExcluded('id_rsa.pub')).toBe(true)
		expect(patdownPathIsExcluded('server.pem')).toBe(true)
		expect(patdownPathIsExcluded('credentials.json')).toBe(true)
		expect(patdownPathIsExcluded('secrets.yaml')).toBe(true)
		expect(patdownPathIsExcluded('secrets.yml')).toBe(true)
		expect(patdownPathIsExcluded('.envrc')).toBe(false)
		expect(patdownPathIsExcluded('README.md')).toBe(false)
	})
})
