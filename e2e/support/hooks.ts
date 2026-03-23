import {
  BeforeAll,
  AfterAll,
  Before,
  After,
  setDefaultTimeout,
} from '@cucumber/cucumber'
import { chromium, type Browser } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import type { EpdsWorld } from './world.js'
import { testEnv } from './env.js'

// Railway services have cold-start latency. Default cucumber step timeout
// is 5 seconds which is too short for OAuth redirect chains.
setDefaultTimeout(60_000)

let sharedBrowser: Browser

BeforeAll(async function () {
  await mkdir('reports/screenshots', { recursive: true })
  sharedBrowser = await chromium.launch({ headless: testEnv.headless })
})

Before(async function (this: EpdsWorld) {
  this.context = await sharedBrowser.newContext()
  this.page = await this.context.newPage()
  this.page.setDefaultNavigationTimeout(30_000)
  this.page.setDefaultTimeout(15_000)
})

After(async function (this: EpdsWorld, scenario) {
  if (scenario.result?.status === 'FAILED') {
    const safeName = scenario.pickle.name
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      .slice(0, 100)
    await this.page?.screenshot({
      path: `reports/screenshots/${safeName}.png`,
      fullPage: true,
    })
  }
  await this.context?.close()
})

AfterAll(async function () {
  await sharedBrowser?.close()
})
