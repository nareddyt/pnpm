import prepare from '@pnpm/prepare'
import fs = require('mz/fs')
import path = require('path')
import exists = require('path-exists')
import rimraf = require('rimraf-then')
import { addDependenciesToPackage } from 'supi'
import tape = require('tape')
import promisifyTape from 'tape-promise'
import { testDefaults } from '../utils'

const test = promisifyTape(tape)
test['only'] = promisifyTape(tape.only) // tslint:disable-line:no-string-literal

test('caching side effects of native package', async (t) => {
  const project = prepare(t)

  const opts = await testDefaults({ sideEffectsCache: true })
  await addDependenciesToPackage(['runas@3.1.1'], opts)
  const cacheBuildDir = path.join(opts.store, 'localhost+4873', 'runas', '3.1.1', 'side_effects', `${process.platform}-${process.arch}-node-${process.version.split('.')[0]}`, 'package', 'build')
  const stat1 = await fs.stat(cacheBuildDir)

  t.ok(await exists(path.join('node_modules', 'runas', 'build')), 'build folder created')
  t.ok(await exists(cacheBuildDir), 'build folder created in side effects cache')

  await addDependenciesToPackage(['runas@3.1.1'], opts)
  const stat2 = await fs.stat(cacheBuildDir)
  t.equal(stat1.ino, stat2.ino, 'existing cache is not overridden')

  opts.force = true
  await addDependenciesToPackage(['runas@3.1.1'], opts)
  const stat3 = await fs.stat(cacheBuildDir)
  t.notEqual(stat1.ino, stat3.ino, 'cache is overridden when force is true')
})

test('using side effects cache', async (t) => {
  const project = prepare(t)

  // Right now, hardlink does not work with side effects, so we specify copy as the packageImportMethod
  // We disable verifyStoreIntegrity because we are going to change the cache
  const opts = await testDefaults({ sideEffectsCache: true, verifyStoreIntegrity: false }, {}, {}, { packageImportMethod: 'copy' })
  await addDependenciesToPackage(['runas@3.1.1'], opts)

  const cacheBuildDir = path.join(opts.store, 'localhost+4873', 'runas', '3.1.1', 'side_effects', `${process.platform}-${process.arch}-node-${process.version.split('.')[0]}`, 'package', 'build')
  await fs.writeFile(path.join(cacheBuildDir, 'new-file.txt'), 'some new content')

  await rimraf('node_modules')
  await addDependenciesToPackage(['runas@3.1.1'], opts)

  t.ok(await exists(path.join('node_modules', 'runas', 'build', 'new-file.txt')), 'side effects cache correctly used')
})

test('readonly side effects cache', async (t) => {
  const project = prepare(t)

  const opts1 = await testDefaults({ sideEffectsCache: true, verifyStoreIntegrity: false })
  await addDependenciesToPackage(['runas@3.1.1'], opts1)

  // Modify the side effects cache to make sure we are using it
  const cacheBuildDir = path.join(opts1.store, 'localhost+4873', 'runas', '3.1.1', 'side_effects', `${process.platform}-${process.arch}-node-${process.version.split('.')[0]}`, 'package', 'build')
  await fs.writeFile(path.join(cacheBuildDir, 'new-file.txt'), 'some new content')

  await rimraf('node_modules')
  const opts2 = await testDefaults({ sideEffectsCacheReadonly: true, verifyStoreIntegrity: false }, {}, {}, { packageImportMethod: 'copy' })
  await addDependenciesToPackage(['runas@3.1.1'], opts2)

  t.ok(await exists(path.join('node_modules', 'runas', 'build', 'new-file.txt')), 'side effects cache correctly used')

  await rimraf('node_modules')
  // changing version to make sure we don't create the cache
  await addDependenciesToPackage(['runas@3.1.0'], opts2)

  t.ok(await exists(path.join('node_modules', 'runas', 'build')), 'build folder created')
  t.notOk(await exists(path.join(opts2.store, 'localhost+4873', 'runas', '3.1.0', 'side_effects', `${process.platform}-${process.arch}-node-${process.version.split('.')[0]}`, 'package', 'build')), 'cache folder not created')
})

test('uploading errors do not interrupt installation', async (t) => {
  const project = prepare(t)

  const opts = await testDefaults({ sideEffectsCache: true })
  opts.storeController.upload = async () => {
    throw new Error('an unexpected error')
  }
  await addDependenciesToPackage(['runas@3.1.1'], opts)

  t.ok(await exists(path.join('node_modules', 'runas', 'build')), 'build folder created')

  const cacheBuildDir = path.join(opts.store, 'localhost+4873', 'runas', '3.1.1', 'side_effects', `${process.platform}-${process.arch}-node-${process.version.split('.')[0]}`, 'package', 'build')
  t.notOk(await exists(cacheBuildDir), 'side effects cache not created')

  t.end()
})
