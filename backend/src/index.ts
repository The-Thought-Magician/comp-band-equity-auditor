import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { db } from './db/index.js'
import { migrate } from './db/migrate.js'
import { plans, workspaces, settings } from './db/schema.js'
import { eq } from 'drizzle-orm'

import workspacesRoutes from './routes/workspaces.js'
import datasetsRoutes from './routes/datasets.js'
import employeesRoutes from './routes/employees.js'
import bandsetsRoutes from './routes/bandsets.js'
import bandsRoutes from './routes/bands.js'
import fxratesRoutes from './routes/fxrates.js'
import engineRoutes from './routes/engine.js'
import positioningsRoutes from './routes/positionings.js'
import cohortsRoutes from './routes/cohorts.js'
import gapsRoutes from './routes/gaps.js'
import scenariosRoutes from './routes/scenarios.js'
import offersRoutes from './routes/offers.js'
import meritRoutes from './routes/merit.js'
import evidenceRoutes from './routes/evidence.js'
import attestationsRoutes from './routes/attestations.js'
import guardrailsRoutes from './routes/guardrails.js'
import filtersRoutes from './routes/filters.js'
import tagsRoutes from './routes/tags.js'
import notificationsRoutes from './routes/notifications.js'
import webhooksRoutes from './routes/webhooks.js'
import apikeysRoutes from './routes/apikeys.js'
import auditlogRoutes from './routes/auditlog.js'
import settingsRoutes from './routes/settings.js'
import dashboardRoutes from './routes/dashboard.js'
import sampleRoutes from './routes/sample.js'
import billingRoutes from './routes/billing.js'

const app = new Hono()

const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:3000',
  'https://comp-band-equity-auditor-ventures.vercel.app',
]

app.use(
  '*',
  cors({
    origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
    credentials: true,
  }),
)

const api = new Hono()
api.route('/workspaces', workspacesRoutes)
api.route('/datasets', datasetsRoutes)
api.route('/employees', employeesRoutes)
api.route('/bandsets', bandsetsRoutes)
api.route('/bands', bandsRoutes)
api.route('/fxrates', fxratesRoutes)
api.route('/engine', engineRoutes)
api.route('/positionings', positioningsRoutes)
api.route('/cohorts', cohortsRoutes)
api.route('/gaps', gapsRoutes)
api.route('/scenarios', scenariosRoutes)
api.route('/offers', offersRoutes)
api.route('/merit', meritRoutes)
api.route('/evidence', evidenceRoutes)
api.route('/attestations', attestationsRoutes)
api.route('/guardrails', guardrailsRoutes)
api.route('/filters', filtersRoutes)
api.route('/tags', tagsRoutes)
api.route('/notifications', notificationsRoutes)
api.route('/webhooks', webhooksRoutes)
api.route('/apikeys', apikeysRoutes)
api.route('/auditlog', auditlogRoutes)
api.route('/settings', settingsRoutes)
api.route('/dashboard', dashboardRoutes)
api.route('/sample', sampleRoutes)
api.route('/billing', billingRoutes)

app.route('/api/v1', api)
app.get('/health', (c) => c.json({ ok: true }))

const DEMO_WORKSPACE_ID = 'demo-workspace'
const DEMO_OWNER_ID = 'demo-user'

async function seedIfEmpty() {
  // Plans (idempotent: count-then-insert per id).
  const seedPlans = [
    { id: 'free', name: 'Free', price_cents: 0 },
    { id: 'pro', name: 'Pro', price_cents: 9900 },
  ]
  for (const p of seedPlans) {
    const existing = await db.select().from(plans).where(eq(plans.id, p.id)).limit(1)
    if (existing.length === 0) {
      await db.insert(plans).values(p)
    }
  }

  // Demo workspace + settings (idempotent: only when absent).
  const ws = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, DEMO_WORKSPACE_ID))
    .limit(1)
  if (ws.length === 0) {
    await db.insert(workspaces).values({
      id: DEMO_WORKSPACE_ID,
      name: 'Demo Workspace',
      owner_id: DEMO_OWNER_ID,
      base_currency: 'USD',
    })
    const st = await db
      .select()
      .from(settings)
      .where(eq(settings.workspace_id, DEMO_WORKSPACE_ID))
      .limit(1)
    if (st.length === 0) {
      await db.insert(settings).values({ workspace_id: DEMO_WORKSPACE_ID })
    }
  }

  console.log('Seed complete')
}

const port = parseInt(process.env.PORT ?? '3001')

// CRITICAL boot order: bind the port FIRST so the platform health check sees a
// live service immediately, THEN run migrate() + seedIfEmpty() (both idempotent)
// each wrapped in its own try/catch. Never block serve() on a cold DB.
serve({ fetch: app.fetch, port }, () => console.log(`Server running on port ${port}`))

;(async () => {
  try {
    await migrate()
  } catch (e) {
    console.error('Migrate error:', e)
  }
  try {
    await seedIfEmpty()
  } catch (e) {
    console.error('Seed error:', e)
  }
})()

export default app
