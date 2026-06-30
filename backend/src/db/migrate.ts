import { db } from './index.js'
import { sql } from 'drizzle-orm'

const statements: string[] = [
  `CREATE TABLE IF NOT EXISTS workspaces (
    id text PRIMARY KEY,
    name text NOT NULL,
    owner_id text NOT NULL,
    base_currency text NOT NULL DEFAULT 'USD',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS datasets (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    version integer NOT NULL DEFAULT 1,
    label text NOT NULL,
    source text NOT NULL DEFAULT 'upload',
    row_count integer NOT NULL DEFAULT 0,
    rejected_rows jsonb DEFAULT '[]'::jsonb,
    status text NOT NULL DEFAULT 'ready',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS employees (
    id text PRIMARY KEY,
    dataset_id text NOT NULL REFERENCES datasets(id),
    workspace_id text NOT NULL REFERENCES workspaces(id),
    employee_ref text NOT NULL,
    name text,
    level text NOT NULL,
    role_family text NOT NULL,
    geo text NOT NULL,
    gender text,
    ethnicity text,
    tenure_months integer NOT NULL DEFAULT 0,
    hire_date text,
    performance_rating real,
    base_salary real NOT NULL,
    currency text NOT NULL DEFAULT 'USD',
    fte real NOT NULL DEFAULT 1,
    tags jsonb DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS fx_rates (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    from_currency text NOT NULL,
    to_currency text NOT NULL,
    rate real NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, from_currency, to_currency)
  )`,

  `CREATE TABLE IF NOT EXISTS band_sets (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    version integer NOT NULL DEFAULT 1,
    label text NOT NULL,
    effective_from text,
    status text NOT NULL DEFAULT 'draft',
    notes text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS bands (
    id text PRIMARY KEY,
    band_set_id text NOT NULL REFERENCES band_sets(id),
    workspace_id text NOT NULL REFERENCES workspaces(id),
    level text NOT NULL,
    role_family text NOT NULL,
    geo text NOT NULL,
    currency text NOT NULL DEFAULT 'USD',
    min_salary real NOT NULL,
    mid_salary real NOT NULL,
    max_salary real NOT NULL,
    target_compa_low real NOT NULL DEFAULT 0.9,
    target_compa_high real NOT NULL DEFAULT 1.1,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (band_set_id, level, role_family, geo)
  )`,

  `CREATE TABLE IF NOT EXISTS engine_runs (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    dataset_id text NOT NULL REFERENCES datasets(id),
    band_set_id text NOT NULL REFERENCES band_sets(id),
    label text NOT NULL,
    summary jsonb DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'complete',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS positionings (
    id text PRIMARY KEY,
    engine_run_id text NOT NULL REFERENCES engine_runs(id),
    workspace_id text NOT NULL REFERENCES workspaces(id),
    employee_id text NOT NULL REFERENCES employees(id),
    band_id text REFERENCES bands(id),
    compa_ratio real,
    range_penetration real,
    quartile integer,
    flags jsonb DEFAULT '[]'::jsonb,
    base_salary_normalized real,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS cohorts (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    definition jsonb DEFAULT '{}'::jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS gap_runs (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    dataset_id text NOT NULL REFERENCES datasets(id),
    band_set_id text REFERENCES band_sets(id),
    reference_group text,
    summary jsonb DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'complete',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS gap_results (
    id text PRIMARY KEY,
    gap_run_id text NOT NULL REFERENCES gap_runs(id),
    workspace_id text NOT NULL REFERENCES workspaces(id),
    cohort_key text NOT NULL,
    dimension text NOT NULL,
    raw_gap_pct real,
    adjusted_gap_pct real,
    explained_pct real,
    unexplained_pct real,
    group_size integer,
    mean_pay real,
    decomposition jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS scenarios (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    dataset_id text NOT NULL REFERENCES datasets(id),
    band_set_id text NOT NULL REFERENCES band_sets(id),
    name text NOT NULL,
    target_type text NOT NULL DEFAULT 'to_min',
    constraints jsonb DEFAULT '{}'::jsonb,
    total_budget_cents integer NOT NULL DEFAULT 0,
    headcount_affected integer NOT NULL DEFAULT 0,
    residual_gap_pct real,
    status text NOT NULL DEFAULT 'complete',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS scenario_adjustments (
    id text PRIMARY KEY,
    scenario_id text NOT NULL REFERENCES scenarios(id),
    workspace_id text NOT NULL REFERENCES workspaces(id),
    employee_id text NOT NULL REFERENCES employees(id),
    current_salary real NOT NULL,
    proposed_salary real NOT NULL,
    delta_cents integer NOT NULL DEFAULT 0,
    rationale text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS offers (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    band_set_id text NOT NULL REFERENCES band_sets(id),
    candidate_label text NOT NULL,
    level text NOT NULL,
    role_family text NOT NULL,
    geo text NOT NULL,
    proposed_salary real NOT NULL,
    currency text NOT NULL DEFAULT 'USD',
    compa_ratio real,
    range_penetration real,
    flags jsonb DEFAULT '[]'::jsonb,
    decision text NOT NULL DEFAULT 'pending',
    reviewer text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS merit_cycles (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    dataset_id text NOT NULL REFERENCES datasets(id),
    band_set_id text NOT NULL REFERENCES band_sets(id),
    name text NOT NULL,
    budget_cents integer NOT NULL DEFAULT 0,
    model text NOT NULL DEFAULT 'compa_ratio',
    status text NOT NULL DEFAULT 'draft',
    summary jsonb DEFAULT '{}'::jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS merit_allocations (
    id text PRIMARY KEY,
    merit_cycle_id text NOT NULL REFERENCES merit_cycles(id),
    workspace_id text NOT NULL REFERENCES workspaces(id),
    employee_id text NOT NULL REFERENCES employees(id),
    current_salary real NOT NULL,
    recommended_increase_cents integer NOT NULL DEFAULT 0,
    final_increase_cents integer NOT NULL DEFAULT 0,
    override_reason text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS evidence_packs (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    gap_run_id text REFERENCES gap_runs(id),
    scenario_id text REFERENCES scenarios(id),
    band_set_id text REFERENCES band_sets(id),
    title text NOT NULL,
    methodology text,
    contents jsonb DEFAULT '{}'::jsonb,
    share_token text UNIQUE,
    status text NOT NULL DEFAULT 'draft',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS attestations (
    id text PRIMARY KEY,
    evidence_pack_id text NOT NULL REFERENCES evidence_packs(id),
    workspace_id text NOT NULL REFERENCES workspaces(id),
    approver_name text NOT NULL,
    approver_id text,
    attested_at timestamptz NOT NULL DEFAULT now(),
    note text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS guardrail_rules (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    rule_type text NOT NULL,
    threshold real,
    action text NOT NULL DEFAULT 'warn',
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS saved_filters (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    target_type text NOT NULL,
    definition jsonb DEFAULT '{}'::jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS tags (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    color text NOT NULL DEFAULT '#6366f1',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, name)
  )`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text,
    read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS webhooks (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    url text NOT NULL,
    events jsonb DEFAULT '[]'::jsonb,
    secret text,
    enabled boolean NOT NULL DEFAULT true,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id text PRIMARY KEY,
    webhook_id text NOT NULL REFERENCES webhooks(id),
    workspace_id text NOT NULL REFERENCES workspaces(id),
    event text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    response_code integer,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS api_keys (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    key_prefix text NOT NULL,
    key_hash text NOT NULL,
    last_used_at timestamptz,
    revoked boolean NOT NULL DEFAULT false,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS audit_log (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    actor_id text NOT NULL,
    action text NOT NULL,
    target_type text,
    target_id text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS settings (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id) UNIQUE,
    base_currency text NOT NULL DEFAULT 'USD',
    default_reference_group text NOT NULL DEFAULT 'male',
    gap_threshold_pct real NOT NULL DEFAULT 5,
    pii_masking boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS plans (
    id text PRIMARY KEY,
    name text NOT NULL,
    price_cents integer NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS subscriptions (
    id text PRIMARY KEY,
    user_id text NOT NULL UNIQUE,
    plan_id text NOT NULL DEFAULT 'free',
    stripe_customer_id text,
    stripe_subscription_id text,
    status text NOT NULL DEFAULT 'active',
    current_period_end timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  // Indexes on FKs / workspace_id
  `CREATE INDEX IF NOT EXISTS idx_datasets_workspace ON datasets(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_employees_workspace ON employees(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_employees_dataset ON employees(dataset_id)`,
  `CREATE INDEX IF NOT EXISTS idx_fx_rates_workspace ON fx_rates(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_band_sets_workspace ON band_sets(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bands_workspace ON bands(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bands_band_set ON bands(band_set_id)`,
  `CREATE INDEX IF NOT EXISTS idx_engine_runs_workspace ON engine_runs(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_positionings_workspace ON positionings(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_positionings_run ON positionings(engine_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cohorts_workspace ON cohorts(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_gap_runs_workspace ON gap_runs(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_gap_results_workspace ON gap_results(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_gap_results_run ON gap_results(gap_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_scenarios_workspace ON scenarios(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_scenario_adjustments_workspace ON scenario_adjustments(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_scenario_adjustments_scenario ON scenario_adjustments(scenario_id)`,
  `CREATE INDEX IF NOT EXISTS idx_offers_workspace ON offers(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_merit_cycles_workspace ON merit_cycles(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_merit_allocations_workspace ON merit_allocations(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_merit_allocations_cycle ON merit_allocations(merit_cycle_id)`,
  `CREATE INDEX IF NOT EXISTS idx_evidence_packs_workspace ON evidence_packs(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_attestations_workspace ON attestations(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_attestations_pack ON attestations(evidence_pack_id)`,
  `CREATE INDEX IF NOT EXISTS idx_guardrail_rules_workspace ON guardrail_rules(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_saved_filters_workspace ON saved_filters(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tags_workspace ON tags(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_workspace ON notifications(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_webhooks_workspace ON webhooks(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_workspace ON webhook_deliveries(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_api_keys_workspace ON api_keys(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_workspace ON audit_log(workspace_id)`,
]

export async function migrate() {
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt))
  }
  console.log(`Migrated ${statements.length} statements`)
}
