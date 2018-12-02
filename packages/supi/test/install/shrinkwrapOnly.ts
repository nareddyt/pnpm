import prepare from '@pnpm/prepare'
import { fromDir as readPackageJsonFromDir } from '@pnpm/read-package-json'
import fs = require('mz/fs')
import path = require('path')
import sinon = require('sinon')
import {
  addDependenciesToPackage,
  install,
} from 'supi'
import tape = require('tape')
import promisifyTape from 'tape-promise'
import { testDefaults } from '../utils'

const test = promisifyTape(tape)
const testOnly = promisifyTape(tape.only)

test('install with shrinkwrapOnly = true', async (t: tape.Test) => {
  const project = prepare(t)

  const opts = await testDefaults({ shrinkwrapOnly: true, saveExact: true })
  await addDependenciesToPackage(['pkg-with-1-dep@100.0.0'], opts)

  t.deepEqual(await fs.readdir(path.join(opts.store, 'localhost+4873', 'pkg-with-1-dep')), ['100.0.0', 'index.json'])
  t.deepEqual(await fs.readdir(path.join(opts.store, 'localhost+4873', 'dep-of-pkg-with-1-dep')), ['100.1.0', 'index.json'])
  await project.hasNot('pkg-with-1-dep')

  const pkg = await readPackageJsonFromDir(process.cwd())
  t.ok(pkg.dependencies!['pkg-with-1-dep'], 'the new dependency added to package.json')

  const shr = await project.loadShrinkwrap()
  t.ok(shr.dependencies['pkg-with-1-dep'])
  t.ok(shr.packages['/pkg-with-1-dep/100.0.0'])
  t.ok(shr.specifiers['pkg-with-1-dep'])

  const currentShr = await project.loadCurrentShrinkwrap()
  t.notOk(currentShr, 'current shrinkwrap not created')

  t.comment('doing repeat install when shrinkwrap.yaml is available already')
  await install(opts)

  t.deepEqual(await fs.readdir(path.join(opts.store, 'localhost+4873', 'pkg-with-1-dep')), ['100.0.0', 'index.json'])
  t.deepEqual(await fs.readdir(path.join(opts.store, 'localhost+4873', 'dep-of-pkg-with-1-dep')), ['100.1.0', 'index.json'])
  await project.hasNot('pkg-with-1-dep')

  t.notOk(await project.loadCurrentShrinkwrap(), 'current shrinkwrap not created')
})

test('warn when installing with shrinkwrapOnly = true and node_modules exists', async (t: tape.Test) => {
  const project = prepare(t)
  const reporter = sinon.spy()

  await addDependenciesToPackage(['is-positive'], await testDefaults())
  await addDependenciesToPackage(['rimraf@2.5.1'], await testDefaults({
    reporter,
    shrinkwrapOnly: true,
  }))

  t.ok(reporter.calledWithMatch({
    level: 'warn',
    message: '`node_modules` is present. Shrinkwrap only installation will make it out-of-date',
    name: 'pnpm',
  }), 'log warning')

  await project.storeHas('rimraf', '2.5.1')
  await project.hasNot('rimraf')

  const pkg = await readPackageJsonFromDir(process.cwd())
  t.ok(pkg.dependencies!.rimraf, 'the new dependency added to package.json')

  const shr = await project.loadShrinkwrap()
  t.ok(shr.dependencies.rimraf)
  t.ok(shr.packages['/rimraf/2.5.1'])
  t.ok(shr.specifiers.rimraf)

  const currentShr = await project.loadCurrentShrinkwrap()
  t.notOk(currentShr.packages['/rimraf/2.5.1'], 'current shrinkwrap not changed')
})
