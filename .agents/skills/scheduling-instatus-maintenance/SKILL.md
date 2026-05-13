---
name: scheduling-instatus-maintenance
description: Draft and schedule Instatus maintenance windows for ePDS services. Use when users mention maintenance windows, scheduled maintenance, upgrades/releases, reconfiguration, staging/production ePDS, certified.one, dev.certified.app, or Instatus scheduling.
---

# Scheduling Instatus Maintenance

Use this for ePDS planned maintenance on the Certified Instatus page: release
upgrades, configuration changes, email/provider switches, and similar planned work.

## Golden Rules

- **Draft first unless the user explicitly says to schedule it.**
- Use UTC ISO timestamps (`YYYY-MM-DDTHH:mm:ss.000Z`).
- Follow prior wording and field conventions; do not invent a new style.
- Do not expose or print API keys. If using direct HTTP, summarize only the created maintenance ID and key fields.
- Prefer the Instatus MCP tools for reads. For creates, include component status mappings if the wrapper/tool needs them.

## Status Page and Component IDs

Status page:

- **Certified** — page ID `cmmxeox60009t11pyrg02vclw`, public URL `https://certified.instatus.com`

Staging components:

- `dev.certified.app (ePDS)` — `cmmxf6unk000h1655r6yuwcl2`
- `auth.dev.certified.app (Auth service for dev.certified.app ePDS)` — `cmmxfauhw00e0aa5b6pabeg9r`

Production components:

- `certified.one (ePDS)` — `cmmxf4qrx00exuud43e815zo7`
- `auth.certified.one (Auth service for certified.one ePDS)` — `cmmxf9lq5001ae87amwcw4zm2`

## Scheduling Defaults

Default window length is **60 minutes** unless the user says otherwise.

Prior windows commonly used:

- `notify: true`
- `notifyStart: true`
- `notifyEnd: true`
- `notifyEarly: true`
- `notifyMinutes: 30`
- `autoStart: true`
- `autoEnd: true`
- `isCollapsed: true`
- `impact` / component maintenance status: `UNDERMAINTENANCE`
- `status: NOTSTARTEDYET` for future scheduled work

## Title Patterns

Use concise, consistently formatted titles across staging and production. Put
the work type first when it is meaningful, especially `upgrade`.

- Staging upgrade: `upgrade of dev.certified.app (staging ePDS)`
- Production upgrade: `upgrade of certified.one (production ePDS)`
- Staging reconfiguration: `reconfiguration of dev.certified.app (staging ePDS) - <short description>`
- Production reconfiguration: `reconfiguration of certified.one (production ePDS) - <short description>`
- Other maintenance: `<work type> of <service> (<environment> ePDS) - <short description>`

## Message Patterns

Keep messages concise, usually one sentence. Two short sentences are acceptable when the second sentence calls out the expected temporary impact.

Release upgrade:

```text
We are planning for a scheduled maintenance during that time, to upgrade <environment> to <version>, which <briefly states the user-visible/operator-visible reason>.
```

Examples:

```text
We are planning for a scheduled maintenance during that time, to upgrade staging to 0.6.3, which applies a small cosmetic fix for consistent auth-service page branding.
```

```text
We are planning for a scheduled maintenance during that time, to upgrade from 0.6.1 to 0.6.2, which fixes a few bugs.
```

Reconfiguration / provider switch:

```text
We are planning for a scheduled maintenance during that time to <short action>. <Affected capability> may be briefly unavailable during this period.
```

Example:

```text
We are planning for a scheduled maintenance during that time to switch the email configuration. Email-based login may be briefly unavailable during this period.
```

Generic maintenance:

```text
We are planning for a scheduled maintenance during that time to <short action>. Service availability may be briefly affected during this period.
```

## Draft Format

Show the user a draft like this before scheduling:

```markdown
Draft only — **not scheduled**.

**Maintenance title**
`...`

**Scheduled window**

- **Start:** `...`
- **End:** `...`
- **Duration:** 60 minutes

**Status**
`NOTSTARTEDYET`

**Impact**
`UNDERMAINTENANCE`

**Message**
`...`

**Affected components**

- `component name` — `component_id`
- `component name` — `component_id`
```

## Scheduling Payload

When the user explicitly says to schedule it, create the maintenance on page
`cmmxeox60009t11pyrg02vclw`.

If using direct API, include `statuses` as well as `components`:

```json
{
  "name": "upgrade of dev.certified.app (staging ePDS)",
  "message": "We are planning for a scheduled maintenance during that time, to upgrade staging to 0.6.3, which applies a small cosmetic fix for consistent auth-service page branding.",
  "components": ["cmmxf6unk000h1655r6yuwcl2", "cmmxfauhw00e0aa5b6pabeg9r"],
  "statuses": [
    { "id": "cmmxf6unk000h1655r6yuwcl2", "status": "UNDERMAINTENANCE" },
    { "id": "cmmxfauhw00e0aa5b6pabeg9r", "status": "UNDERMAINTENANCE" }
  ],
  "start": "YYYY-MM-DDTHH:mm:ss.000Z",
  "end": "YYYY-MM-DDTHH:mm:ss.000Z",
  "duration": 60,
  "status": "NOTSTARTEDYET",
  "notify": true,
  "notifyStart": true,
  "notifyEnd": true,
  "notifyEarly": true,
  "notifyMinutes": 30,
  "autoStart": true,
  "autoEnd": true,
  "isCollapsed": true,
  "expandAt": "YYYY-MM-DDTHH:mm:ss.000Z"
}
```

Set `expandAt` to three days before `start` when following recent scheduled
window style. In the sample above, `expandAt` uses the same timestamp format as
`start` / `end`, but the actual value should be three days earlier.

## Completing a Maintenance Window

Do **not** complete maintenance by only updating the parent maintenance record.
Instatus lifecycle changes are driven by **maintenance updates**. A parent
`PUT /v1/{page_id}/maintenances/{maintenance_id}` can accept fields and still
leave the maintenance in `NOTSTARTEDYET`.

When the user says to mark a window complete, add a maintenance update:

```text
POST https://api.instatus.com/v1/cmmxeox60009t11pyrg02vclw/maintenances/<maintenance_id>/maintenance-updates
Authorization: Bearer $INSTATUS_API_KEY
Content-Type: application/json
```

Completion payload shape:

```json
{
  "message": "Upgrade has completed successfully.",
  "components": ["cmmxf6unk000h1655r6yuwcl2", "cmmxfauhw00e0aa5b6pabeg9r"],
  "statuses": [
    { "id": "cmmxf6unk000h1655r6yuwcl2", "status": "OPERATIONAL" },
    { "id": "cmmxfauhw00e0aa5b6pabeg9r", "status": "OPERATIONAL" }
  ],
  "status": "COMPLETED",
  "notify": true,
  "started": "YYYY-MM-DDTHH:mm:ss.000Z"
}
```

Use a message matching the work type:

- Upgrade: `Upgrade has completed successfully.`
- Reconfiguration: `Configuration change has completed successfully.`
- Generic maintenance: `Maintenance has completed successfully.`

After posting the update, re-fetch the maintenance and verify:

- parent `status` is `COMPLETED`
- `resolved` is non-null
- affected components are `OPERATIONAL`
- the latest update has `status: COMPLETED`

## Direct API Fallback

The local `instatus-mcp` wrapper may reject create or update requests because
it omits required `components` / `statuses` fields, and its parent-maintenance
update path is not sufficient for lifecycle transitions. If that happens, call
the Instatus API directly with `INSTATUS_API_KEY` from the environment.

Create scheduled maintenance:

```text
POST https://api.instatus.com/v1/cmmxeox60009t11pyrg02vclw/maintenances
Authorization: Bearer $INSTATUS_API_KEY
Content-Type: application/json
```

Add lifecycle update:

```text
POST https://api.instatus.com/v1/cmmxeox60009t11pyrg02vclw/maintenances/<maintenance_id>/maintenance-updates
Authorization: Bearer $INSTATUS_API_KEY
Content-Type: application/json
```

After scheduling or completing, return only:

- Maintenance title
- Maintenance ID
- Window / resolved time
- Status
- Public URL: `https://certified.instatus.com/maintenance/<maintenance_id>`
