import {
  World,
  type IWorldOptions,
  setWorldConstructor,
} from '@cucumber/cucumber'
import type { BrowserContext, Page } from '@playwright/test'
import { testEnv } from './env.js'

export class EpdsWorld extends World {
  declare context: BrowserContext
  declare page: Page

  constructor(options: IWorldOptions) {
    super(options)
  }

  get env() {
    return testEnv
  }

  /**
   * Call in any step that requires MailHog. If E2E_MAILHOG_URL is not set,
   * marks the step as pending and cucumber-js skips remaining steps in the scenario.
   * When MailHog is available, this is a no-op and the step executes normally.
   */
  skipIfNoMailhog(): void {
    if (!testEnv.mailhogUrl) {
      return this.pending()
    }
  }

  // cucumber-js injects this at runtime; declare it so TypeScript is satisfied
  declare pending: () => never
}

setWorldConstructor(EpdsWorld)
