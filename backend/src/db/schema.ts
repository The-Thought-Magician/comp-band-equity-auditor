import { pgTable, text, integer, boolean, timestamp, jsonb, real, unique } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Core / workspace
// ---------------------------------------------------------------------------

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  owner_id: text('owner_id').notNull(),
  base_currency: text('base_currency').notNull().default('USD'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Data intake
// ---------------------------------------------------------------------------

export const datasets = pgTable('datasets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  version: integer('version').notNull().default(1),
  label: text('label').notNull(),
  source: text('source').notNull().default('upload'),
  row_count: integer('row_count').notNull().default(0),
  rejected_rows: jsonb('rejected_rows').$type<Array<Record<string, unknown>>>().default([]),
  status: text('status').notNull().default('ready'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const employees = pgTable('employees', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  dataset_id: text('dataset_id').notNull().references(() => datasets.id),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  employee_ref: text('employee_ref').notNull(),
  name: text('name'),
  level: text('level').notNull(),
  role_family: text('role_family').notNull(),
  geo: text('geo').notNull(),
  gender: text('gender'),
  ethnicity: text('ethnicity'),
  tenure_months: integer('tenure_months').notNull().default(0),
  hire_date: text('hire_date'),
  performance_rating: real('performance_rating'),
  base_salary: real('base_salary').notNull(),
  currency: text('currency').notNull().default('USD'),
  fte: real('fte').notNull().default(1),
  tags: jsonb('tags').$type<string[]>().default([]),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const fx_rates = pgTable('fx_rates', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  from_currency: text('from_currency').notNull(),
  to_currency: text('to_currency').notNull(),
  rate: real('rate').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.from_currency, t.to_currency)])

// ---------------------------------------------------------------------------
// Band designer
// ---------------------------------------------------------------------------

export const band_sets = pgTable('band_sets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  version: integer('version').notNull().default(1),
  label: text('label').notNull(),
  effective_from: text('effective_from'),
  status: text('status').notNull().default('draft'),
  notes: text('notes'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const bands = pgTable('bands', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  band_set_id: text('band_set_id').notNull().references(() => band_sets.id),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  level: text('level').notNull(),
  role_family: text('role_family').notNull(),
  geo: text('geo').notNull(),
  currency: text('currency').notNull().default('USD'),
  min_salary: real('min_salary').notNull(),
  mid_salary: real('mid_salary').notNull(),
  max_salary: real('max_salary').notNull(),
  target_compa_low: real('target_compa_low').notNull().default(0.9),
  target_compa_high: real('target_compa_high').notNull().default(1.1),
  notes: text('notes'),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.band_set_id, t.level, t.role_family, t.geo)])

// ---------------------------------------------------------------------------
// Compa-ratio engine
// ---------------------------------------------------------------------------

export const engine_runs = pgTable('engine_runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  dataset_id: text('dataset_id').notNull().references(() => datasets.id),
  band_set_id: text('band_set_id').notNull().references(() => band_sets.id),
  label: text('label').notNull(),
  summary: jsonb('summary').$type<Record<string, unknown>>().default({}),
  status: text('status').notNull().default('complete'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const positionings = pgTable('positionings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  engine_run_id: text('engine_run_id').notNull().references(() => engine_runs.id),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  employee_id: text('employee_id').notNull().references(() => employees.id),
  band_id: text('band_id').references(() => bands.id),
  compa_ratio: real('compa_ratio'),
  range_penetration: real('range_penetration'),
  quartile: integer('quartile'),
  flags: jsonb('flags').$type<string[]>().default([]),
  base_salary_normalized: real('base_salary_normalized'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Cohorts + gap analysis
// ---------------------------------------------------------------------------

export const cohorts = pgTable('cohorts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  definition: jsonb('definition').$type<Record<string, unknown>>().default({}),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const gap_runs = pgTable('gap_runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  dataset_id: text('dataset_id').notNull().references(() => datasets.id),
  band_set_id: text('band_set_id').references(() => band_sets.id),
  reference_group: text('reference_group'),
  summary: jsonb('summary').$type<Record<string, unknown>>().default({}),
  status: text('status').notNull().default('complete'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const gap_results = pgTable('gap_results', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  gap_run_id: text('gap_run_id').notNull().references(() => gap_runs.id),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  cohort_key: text('cohort_key').notNull(),
  dimension: text('dimension').notNull(),
  raw_gap_pct: real('raw_gap_pct'),
  adjusted_gap_pct: real('adjusted_gap_pct'),
  explained_pct: real('explained_pct'),
  unexplained_pct: real('unexplained_pct'),
  group_size: integer('group_size'),
  mean_pay: real('mean_pay'),
  decomposition: jsonb('decomposition').$type<Record<string, number>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Remediation scenarios
// ---------------------------------------------------------------------------

export const scenarios = pgTable('scenarios', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  dataset_id: text('dataset_id').notNull().references(() => datasets.id),
  band_set_id: text('band_set_id').notNull().references(() => band_sets.id),
  name: text('name').notNull(),
  target_type: text('target_type').notNull().default('to_min'),
  constraints: jsonb('constraints').$type<Record<string, unknown>>().default({}),
  total_budget_cents: integer('total_budget_cents').notNull().default(0),
  headcount_affected: integer('headcount_affected').notNull().default(0),
  residual_gap_pct: real('residual_gap_pct'),
  status: text('status').notNull().default('complete'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const scenario_adjustments = pgTable('scenario_adjustments', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  scenario_id: text('scenario_id').notNull().references(() => scenarios.id),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  employee_id: text('employee_id').notNull().references(() => employees.id),
  current_salary: real('current_salary').notNull(),
  proposed_salary: real('proposed_salary').notNull(),
  delta_cents: integer('delta_cents').notNull().default(0),
  rationale: text('rationale'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Offer guardrails
// ---------------------------------------------------------------------------

export const offers = pgTable('offers', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  band_set_id: text('band_set_id').notNull().references(() => band_sets.id),
  candidate_label: text('candidate_label').notNull(),
  level: text('level').notNull(),
  role_family: text('role_family').notNull(),
  geo: text('geo').notNull(),
  proposed_salary: real('proposed_salary').notNull(),
  currency: text('currency').notNull().default('USD'),
  compa_ratio: real('compa_ratio'),
  range_penetration: real('range_penetration'),
  flags: jsonb('flags').$type<string[]>().default([]),
  decision: text('decision').notNull().default('pending'),
  reviewer: text('reviewer'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Merit cycle planner
// ---------------------------------------------------------------------------

export const merit_cycles = pgTable('merit_cycles', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  dataset_id: text('dataset_id').notNull().references(() => datasets.id),
  band_set_id: text('band_set_id').notNull().references(() => band_sets.id),
  name: text('name').notNull(),
  budget_cents: integer('budget_cents').notNull().default(0),
  model: text('model').notNull().default('compa_ratio'),
  status: text('status').notNull().default('draft'),
  summary: jsonb('summary').$type<Record<string, unknown>>().default({}),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const merit_allocations = pgTable('merit_allocations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  merit_cycle_id: text('merit_cycle_id').notNull().references(() => merit_cycles.id),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  employee_id: text('employee_id').notNull().references(() => employees.id),
  current_salary: real('current_salary').notNull(),
  recommended_increase_cents: integer('recommended_increase_cents').notNull().default(0),
  final_increase_cents: integer('final_increase_cents').notNull().default(0),
  override_reason: text('override_reason'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Evidence pack + attestation
// ---------------------------------------------------------------------------

export const evidence_packs = pgTable('evidence_packs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  gap_run_id: text('gap_run_id').references(() => gap_runs.id),
  scenario_id: text('scenario_id').references(() => scenarios.id),
  band_set_id: text('band_set_id').references(() => band_sets.id),
  title: text('title').notNull(),
  methodology: text('methodology'),
  contents: jsonb('contents').$type<Record<string, unknown>>().default({}),
  share_token: text('share_token').unique(),
  status: text('status').notNull().default('draft'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const attestations = pgTable('attestations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  evidence_pack_id: text('evidence_pack_id').notNull().references(() => evidence_packs.id),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  approver_name: text('approver_name').notNull(),
  approver_id: text('approver_id'),
  attested_at: timestamp('attested_at').defaultNow().notNull(),
  note: text('note'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Rules / filters / tags
// ---------------------------------------------------------------------------

export const guardrail_rules = pgTable('guardrail_rules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  rule_type: text('rule_type').notNull(),
  threshold: real('threshold'),
  action: text('action').notNull().default('warn'),
  enabled: boolean('enabled').notNull().default(true),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const saved_filters = pgTable('saved_filters', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  target_type: text('target_type').notNull(),
  definition: jsonb('definition').$type<Record<string, unknown>>().default({}),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const tags = pgTable('tags', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  color: text('color').notNull().default('#6366f1'),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.name)])

// ---------------------------------------------------------------------------
// Notifications / webhooks / api keys / audit log
// ---------------------------------------------------------------------------

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  read: boolean('read').notNull().default(false),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const webhooks = pgTable('webhooks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  url: text('url').notNull(),
  events: jsonb('events').$type<string[]>().default([]),
  secret: text('secret'),
  enabled: boolean('enabled').notNull().default(true),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const webhook_deliveries = pgTable('webhook_deliveries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  webhook_id: text('webhook_id').notNull().references(() => webhooks.id),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  event: text('event').notNull(),
  status: text('status').notNull().default('pending'),
  response_code: integer('response_code'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const api_keys = pgTable('api_keys', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  key_prefix: text('key_prefix').notNull(),
  key_hash: text('key_hash').notNull(),
  last_used_at: timestamp('last_used_at'),
  revoked: boolean('revoked').notNull().default(false),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const audit_log = pgTable('audit_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  actor_id: text('actor_id').notNull(),
  action: text('action').notNull(),
  target_type: text('target_type'),
  target_id: text('target_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const settings = pgTable('settings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id).unique(),
  base_currency: text('base_currency').notNull().default('USD'),
  default_reference_group: text('default_reference_group').notNull().default('male'),
  gap_threshold_pct: real('gap_threshold_pct').notNull().default(5),
  pii_masking: boolean('pii_masking').notNull().default(false),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  price_cents: integer('price_cents').notNull().default(0),
})

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().unique(),
  plan_id: text('plan_id').notNull().default('free'),
  stripe_customer_id: text('stripe_customer_id'),
  stripe_subscription_id: text('stripe_subscription_id'),
  status: text('status').notNull().default('active'),
  current_period_end: timestamp('current_period_end'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})
