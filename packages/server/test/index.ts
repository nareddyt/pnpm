///<reference path="../typings/index.d.ts"/>
import fs = require('mz/fs')
import path = require('path')
import rimraf = require('rimraf-then')

import createResolver, { PackageMetaCache } from '@pnpm/npm-resolver'
import createStore from '@pnpm/package-store'
import {
  connectStoreController,
  createServer,
 } from '@pnpm/server'
import { FindPackageUsagesResponse, PackageFilesResponse } from '@pnpm/store-controller-types'
import createFetcher from '@pnpm/tarball-fetcher'
import got = require('got')
import isPortReachable = require('is-port-reachable')
import test = require('tape')

const registry = 'https://registry.npmjs.org/'

async function createStoreController () {
  const rawNpmConfig = { registry }
  const store = '.store'
  const resolve = createResolver({
    metaCache: new Map<string, object>() as PackageMetaCache,
    rawNpmConfig,
    store,
  })
  const fetchers = createFetcher({
    alwaysAuth: true,
    rawNpmConfig,
    registry,
    strictSsl: true,
  })
  return createStore(resolve, fetchers, {
    locks: undefined,
    lockStaleDuration: 100,
    networkConcurrency: 1,
    store: store,
  })
}

test('server', async t => {
  const port = 5813
  const hostname = '127.0.0.1'
  const remotePrefix = `http://${hostname}:${port}`
  const storeCtrlForServer = await createStoreController()
  const server = createServer(storeCtrlForServer, {
    hostname,
    port,
  })
  const storeCtrl = await connectStoreController({ remotePrefix, concurrency: 100 })
  const response = await storeCtrl.requestPackage(
    { alias: 'is-positive', pref: '1.0.0' },
    {
      downloadPriority: 0,
      loggedPkg: { rawSpec: 'sfdf' },
      preferredVersions: {},
      prefix: process.cwd(),
      registry,
      sideEffectsCache: false,
      verifyStoreIntegrity: false,
    }
  )

  t.equal((await response['fetchingRawManifest']).name, 'is-positive', 'responded with fetchingRawManifest')
  t.equal(response.body.id, 'registry.npmjs.org/is-positive/1.0.0', 'responded with correct ID')

  t.equal(response.body['manifest'].name, 'is-positive', 'responded with correct name in manifest')
  t.equal(response.body['manifest'].version, '1.0.0', 'responded with correct version in manifest')

  const files = await response['fetchingFiles'] as PackageFilesResponse
  t.notOk(files.fromStore)
  t.ok(files.filenames.indexOf('package.json') !== -1)
  t.ok(response['finishing'])

  await response['finishing']

  await server.close()
  await storeCtrl.close()
  t.end()
})

test('fetchPackage', async t => {
  const port = 5813
  const hostname = '127.0.0.1'
  const remotePrefix = `http://${hostname}:${port}`
  const storeCtrlForServer = await createStoreController()
  const server = createServer(storeCtrlForServer, {
    hostname,
    port,
  })
  const storeCtrl = await connectStoreController({ remotePrefix, concurrency: 100 })
  const response = await storeCtrl.fetchPackage({
    fetchRawManifest: true,
    force: false,
    pkgId: 'registry.npmjs.org/is-positive/1.0.0',
    prefix: process.cwd(),
    resolution: {
      integrity: 'sha1-iACYVrZKLx632LsBeUGEJK4EUss=',
      registry: 'https://registry.npmjs.org/',
      tarball: 'https://registry.npmjs.org/is-positive/-/is-positive-1.0.0.tgz',
    },
    verifyStoreIntegrity: true,
  })

  t.equal(typeof response.inStoreLocation, 'string', 'location in store returned')

  t.ok(await response.fetchingRawManifest)

  const files = await response['fetchingFiles'] as PackageFilesResponse
  t.notOk(files.fromStore)
  t.ok(files.filenames.indexOf('package.json') !== -1)
  t.ok(response['finishing'])

  await response['finishing']

  await server.close()
  await storeCtrl.close()
  t.end()
})

test('server errors should arrive to the client', async t => {
  const port = 5813
  const hostname = '127.0.0.1'
  const remotePrefix = `http://${hostname}:${port}`
  const storeCtrlForServer = await createStoreController()
  const server = createServer(storeCtrlForServer, {
    hostname,
    port,
  })
  const storeCtrl = await connectStoreController({ remotePrefix, concurrency: 100 })
  let caught = false
  try {
    await storeCtrl.requestPackage(
      { alias: 'not-an-existing-package', pref: '1.0.0' },
      {
        downloadPriority: 0,
        loggedPkg: { rawSpec: 'sfdf' },
        preferredVersions: {},
        prefix: process.cwd(),
        registry,
        sideEffectsCache: false,
        verifyStoreIntegrity: false,
      }
    )
  } catch (e) {
    caught = true
    t.equal(e.message, '404 Not Found: not-an-existing-package (via https://registry.npmjs.org/not-an-existing-package)', 'error message delivered correctly')
    t.equal(e.code, 'ERR_PNPM_REGISTRY_META_RESPONSE_404', 'error code delivered correctly')
    t.ok(e.uri, 'error uri field delivered')
    t.ok(e.response, 'error response field delivered')
    t.ok(e.package, 'error package field delivered')
  }
  t.ok(caught, 'exception raised correctly')

  await server.close()
  await storeCtrl.close()
  t.end()
})

test('server upload', async t => {
  const port = 5813
  const hostname = '127.0.0.1'
  const remotePrefix = `http://${hostname}:${port}`
  const storeCtrlForServer = await createStoreController()
  const server = createServer(storeCtrlForServer, {
    hostname,
    port,
  })
  const storeCtrl = await connectStoreController({ remotePrefix, concurrency: 100 })

  const fakeEngine = 'client-engine'
  const fakePkgId = 'test.example.com/fake-pkg/1.0.0'

  await storeCtrl.upload(path.join(__dirname, 'side-effect-fake-dir'), {
    engine: fakeEngine,
    pkgId: fakePkgId,
  })

  const cachePath = path.join('.store', fakePkgId, 'side_effects', fakeEngine, 'package')
  t.ok(await fs.exists(cachePath), 'cache directory created')
  t.deepEqual(await fs.readdir(cachePath), ['side-effect.js', 'side-effect.txt'], 'all files uploaded to cache')

  await server.close()
  await storeCtrl.close()
  t.end()
})

test('disable server upload', async t => {
  await rimraf('.store')

  const port = 5813
  const hostname = '127.0.0.1'
  const remotePrefix = `http://${hostname}:${port}`
  const storeCtrlForServer = await createStoreController()
  const server = createServer(storeCtrlForServer, {
    hostname,
    ignoreUploadRequests: true,
    port,
  })
  const storeCtrl = await connectStoreController({ remotePrefix, concurrency: 100 })

  const fakeEngine = 'client-engine'
  const fakePkgId = 'test.example.com/fake-pkg/1.0.0'

  let thrown = false
  try {
    await storeCtrl.upload(path.join(__dirname, 'side-effect-fake-dir'), {
      engine: fakeEngine,
      pkgId: fakePkgId,
    })
  } catch (e) {
    thrown = true
  }
  t.ok(thrown, 'error is thrown when trying to upload')

  const cachePath = path.join('.store', fakePkgId, 'side_effects', fakeEngine, 'package')
  t.notOk(await fs.exists(cachePath), 'cache directory not created')

  await server.close()
  await storeCtrl.close()
  t.end()
})

test('stop server with remote call', async t => {
  const port = 5813
  const hostname = '127.0.0.1'
  const remotePrefix = `http://${hostname}:${port}`
  const storeCtrlForServer = await createStoreController()
  const server = createServer(storeCtrlForServer, {
    hostname,
    ignoreStopRequests: false,
    port,
  })

  t.ok(await isPortReachable(port), 'server is running')

  const response = await got(`${remotePrefix}/stop`, { method: 'POST' })

  t.equal(response.statusCode, 200, 'success returned by server stopping endpoint')

  t.notOk(await isPortReachable(port), 'server is not running')

  t.end()
})

test('disallow stop server with remote call', async t => {
  const port = 5813
  const hostname = '127.0.0.1'
  const remotePrefix = `http://${hostname}:${port}`
  const storeCtrlForServer = await createStoreController()
  const server = createServer(storeCtrlForServer, {
    hostname,
    ignoreStopRequests: true,
    port,
  })

  t.ok(await isPortReachable(port), 'server is running')

  try {
    const response = await got(`${remotePrefix}/stop`, { method: 'POST' })
    t.fail('request should have failed')
  } catch (err) {
    t.equal(err.statusCode, 403, 'server not stopped')
  }

  t.ok(await isPortReachable(port), 'server is running')

  await server.close()
  t.end()
})

test('disallow store prune', async t => {
  const port = 5813
  const hostname = '127.0.0.1'
  const remotePrefix = `http://${hostname}:${port}`
  const storeCtrlForServer = await createStoreController()
  const server = createServer(storeCtrlForServer, {
    hostname,
    port,
  })

  t.ok(await isPortReachable(port), 'server is running')

  try {
    const response = await got(`${remotePrefix}/prune`, { method: 'POST' })
    t.fail('request should have failed')
  } catch (err) {
    t.equal(err.statusCode, 403, 'store not pruned')
  }

  await server.close()
  await storeCtrlForServer.close()
  t.end()
})

test('find package usages', async t => {
  const port = 5813
  const hostname = '127.0.0.1'
  const remotePrefix = `http://${hostname}:${port}`
  const storeCtrlForServer = await createStoreController()
  const server = createServer(storeCtrlForServer, {
    hostname,
    port,
  })
  const storeCtrl = await connectStoreController({ remotePrefix, concurrency: 100 })

  const dependency = { alias: 'is-positive', pref: '1.0.0' };

  // First install a dependency
  const requestResponse = await storeCtrl.requestPackage(
    dependency,
    {
      downloadPriority: 0,
      loggedPkg: { rawSpec: 'sfdf' },
      preferredVersions: {},
      prefix: process.cwd(),
      registry,
      sideEffectsCache: false,
      verifyStoreIntegrity: false,
    }
  );
  await requestResponse['fetchingRawManifest'];
  await requestResponse['finishing'];

  // For debugging purposes
  await storeCtrl.saveState();

  // Now check if usages shows up
  const deps = [dependency];
  const packageUsagesResponses: FindPackageUsagesResponse[] = await storeCtrl.findPackageUsages(deps);

  t.equal(packageUsagesResponses.length, 1, 'number of items in response should be 1');

  const packageUsageResponse = packageUsagesResponses[0];

  t.deepEqual(packageUsageResponse.dependency, dependency, 'query does not match');
  t.true(packageUsageResponse.foundInStore, 'query not found in store');
  t.equal(packageUsageResponse.packages.length, 1, 'there should only be 1 package returned from the query');

  const packageUsed = packageUsageResponse.packages[0];

  t.ok(packageUsed.id, 'there should be a package id');
  t.equal(packageUsed.usages.length, 0, 'package should not be used by any projects');

  await server.close();
  await storeCtrl.close();
  t.end()
});
