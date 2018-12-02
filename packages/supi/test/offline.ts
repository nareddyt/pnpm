import prepare from '@pnpm/prepare'
import rimraf = require('rimraf-then')
import { addDependenciesToPackage, install, installPkgs } from 'supi'
import tape = require('tape')
import promisifyTape from 'tape-promise'
import { testDefaults } from './utils'

const test = promisifyTape(tape)

test('offline installation fails when package meta not found in local registry mirror', async (t) => {
  const project = prepare(t)

  try {
    await addDependenciesToPackage(['is-positive@3.0.0'], await testDefaults({}, { offline: true }, { offline: true }))
    t.fail('installation should have failed')
  } catch (err) {
    t.equal(err.code, 'NO_OFFLINE_META', 'failed with correct error code')
  }
})

test('offline installation fails when package tarball not found in local registry mirror', async (t) => {
  const project = prepare(t)

  await addDependenciesToPackage(['is-positive@3.0.0'], await testDefaults())

  await rimraf('node_modules')

  try {
    await addDependenciesToPackage(['is-positive@3.1.0'], await testDefaults({}, { offline: true }, { offline: true }))
    t.fail('installation should have failed')
  } catch (err) {
    t.equal(err.code, 'NO_OFFLINE_TARBALL', 'failed with correct error code')
  }
})

test('successful offline installation', async (t) => {
  const project = prepare(t)

  await addDependenciesToPackage(['is-positive@3.0.0'], await testDefaults({ save: true }))

  await rimraf('node_modules')

  await install(await testDefaults({}, { offline: true }, { offline: true }))

  const m = project.requireModule('is-positive')
  t.ok(typeof m === 'function', 'module is available')
})
