#!/usr/bin/env node

/**
 * Create an API client for headless OTP endpoints.
 *
 * Usage:
 *   node scripts/create-api-client.mjs --name "CoolApp" [options]
 *
 * Options:
 *   --name <name>              Client display name (required)
 *   --client-id <url>          client-metadata.json URL for email branding
 *   --allowed-origins <list>   Comma-separated allowed origins
 *   --no-signup                Disable OTP-based account creation
 *   --can-create-directly      Allow no-OTP account creation via
 *                              POST /_internal/account/create (default: off)
 *   --rate-limit <n>           Requests per hour (default: 10000)
 *   --db <path>                Path to ePDS SQLite database
 *                              (default: ./data/epds.sqlite)
 */

import { randomBytes, createHash, randomUUID } from 'node:crypto'
import { EpdsDb } from '../packages/shared/dist/index.js'

function parseArgs(argv) {
  const args = {
    name: null,
    clientId: null,
    allowedOrigins: null,
    canSignup: true,
    canCreateDirectly: false,
    rateLimit: 10000,
    db: './data/epds.sqlite',
  }

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--name':
        args.name = argv[++i]
        break
      case '--client-id':
        args.clientId = argv[++i]
        break
      case '--allowed-origins':
        args.allowedOrigins = argv[++i]
        break
      case '--no-signup':
        args.canSignup = false
        break
      case '--can-create-directly':
        args.canCreateDirectly = true
        break
      case '--rate-limit':
        args.rateLimit = parseInt(argv[++i], 10)
        break
      case '--db':
        args.db = argv[++i]
        break
      default:
        console.error(`Unknown argument: ${argv[i]}`)
        process.exit(1)
    }
  }

  return args
}

const args = parseArgs(process.argv)

if (!args.name) {
  console.error('Error: --name is required')
  console.error(
    'Usage: node scripts/create-api-client.mjs --name "CoolApp" [options]',
  )
  process.exit(1)
}

if (isNaN(args.rateLimit) || args.rateLimit < 1) {
  console.error('Error: --rate-limit must be a positive integer')
  process.exit(1)
}

const db = new EpdsDb(args.db)

try {
  const id = randomUUID()
  const apiKey = randomBytes(32).toString('hex')
  const apiKeyHash = createHash('sha256').update(apiKey).digest('hex')

  db.createApiClient({
    id,
    name: args.name,
    clientId: args.clientId,
    apiKeyHash,
    allowedOrigins: args.allowedOrigins,
    canSignup: args.canSignup,
    canCreateDirectly: args.canCreateDirectly,
    rateLimitPerHour: args.rateLimit,
  })

  console.log()
  console.log('API client created successfully!')
  console.log()
  console.log(`  Client ID:  ${id}`)
  console.log(`  Name:       ${args.name}`)
  console.log(`  API Key:    ${apiKey}`)
  console.log()
  console.log('Save this API key now — it cannot be retrieved later.')
  console.log(
    'Use it in the x-api-key header when calling /_internal/otp/* endpoints.',
  )
  console.log()
} finally {
  db.close()
}
