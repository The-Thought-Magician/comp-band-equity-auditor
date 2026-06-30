# CompBandEquityAuditor — Idea & Feature Specification

## Overview

CompBandEquityAuditor is a pay-equity governance platform for total-rewards teams. It ingests a company's headcount + compensation data, lets the team design and version compensation bands, computes every employee's compa-ratio and range penetration, runs deterministic cohort pay-gap analysis with explainable factor decomposition, simulates the exact remediation budget needed to close gaps, guards new-hire offers against band compression, plans merit cycles against a fixed budget, and produces a timestamped, board-ready evidence pack for pay-transparency filings.

Everything is deterministic math over uploaded data: no black-box ML, fully reproducible numbers a Head of People can defend in front of a board or a regulator. A built-in sample seeder produces a synthetic ~80-employee org with realistic bands and deliberately planted below-min outliers and a gender pay gap so the entire pipeline is demoable on first sign-in.

## Problem

Pay-equity audits are now legally mandated and recurring under pay-transparency regimes (EU Pay Transparency Directive, US state laws, UK gender pay-gap reporting). Yet most total-rewards teams run compa-ratio and gap analysis in fragile, one-off spreadsheets: no version control over bands, no reproducible gap math, no audit trail, and — critically — no defensible remediation costing. When the board asks "what does it cost to fix this and who exactly gets a raise," teams cannot produce a numbers-backed, line-item answer. Spreadsheets also silently break: a moved column, a stale band table, a copy-paste error, and the filed audit is wrong.

## Target Users

VP/Director of Total Rewards, Head of Compensation, or Head of People at companies of 100-2000 employees operating under pay-transparency regimes. Secondary users: comp analysts who do the data work, and People-ops leaders who present to the board.

## Why This Is NOT an Existing Project

- **NOT `hr-platform`** — a general HRIS treats compensation as a single field on an employee record. CompBandEquityAuditor makes the *pay band* the first-class versioned object and the *statutory equity gap* the central computed artifact. It has no org chart, no PTO, no benefits enrollment.
- **NOT `performance-review-system`** — that governs appraisals, ratings, and review cycles. Here performance is merely one *input column* used to explain/justify pay variance; we never run a review.
- **NOT sibling `headcount-plan-reconciler`** — that reconciles planned vs actual *headcount budget* (req counts, open roles, burn). We govern *per-employee pay positioning* against bands and equity law, not the headcount plan.
- **NOT sibling `regrettable-attrition-radar`** — that predicts *flight risk* and attrition. We never model who will leave; we model who is *underpaid relative to band* and what it costs to fix.
- **NOT sibling `discount-leakage-ledger`** — that governs *product pricing/discount* leakage on sales deals. Our "pricing" is employee compensation against internal bands.

The sharp difference: CompBandEquityAuditor governs **employee pay bands + statutory equity gaps with line-item remediation costing**, version-controlled and audit-trailed for filings. No neighbor does compa-ratio + deterministic cohort-gap decomposition + a board-ready remediation budget.

---

## MAJOR FEATURE SECTIONS

### 1. Employee + Compensation Data Intake
- Upload headcount as CSV or JSON; paste raw rows; or generate from the sample seeder.
- Column mapping wizard: map source columns to canonical fields (employee_id, name, level, role, geo, gender, ethnicity_optional, tenure_months, hire_date, performance_rating, base_salary, currency, fte).
- Normalization into a typed comp dataset (a versioned snapshot).
- Per-row validation with downloadable error report (missing salary, unknown level, bad currency, negative tenure).
- Currency normalization to a chosen base currency with a stored FX rate table.
- De-duplication on employee_id; merge strategy (replace/skip/upsert).
- Dataset versioning: each upload creates an immutable snapshot; diff two snapshots.
- PII handling toggle: hash/mask names and ethnicity in exports.
- Import job tracking with status, row counts, and rejected-row download.

### 2. Version-Controlled Comp-Band Designer
- Bands keyed by (level, role-family, geo); each band has min, mid, max, currency, and a compa-ratio target band (e.g. 0.90-1.10).
- Band sets are versioned; publishing a new version is immutable and timestamped.
- Clone-and-edit a band set; diff two band-set versions (added/removed/changed bands).
- Band overlap/inversion linter (e.g. L4 max below L5 min, or geo bands inverted).
- Geo differentials: define a base band and apply geo multipliers.
- Effective-dated bands (a version applies from a date).
- Bulk import band rows from CSV; bulk edit min/mid/max.
- Notes and rationale field per band for audit defensibility.

### 3. Compa-Ratio & Range-Penetration Engine
- Compute compa-ratio = base_salary / band_mid for every employee against a chosen band-set version.
- Compute range penetration = (salary - min) / (max - min).
- Flag anomalies: below-min, above-max, compa-ratio outside target band, salary with no matching band.
- Quartile/segment classification within band (Q1-Q4).
- Distribution stats: mean/median compa-ratio overall and per cohort.
- Per-employee positioning detail with the exact band used and the math shown.
- Snapshot the engine run (inputs + outputs) so results are reproducible and audit-linked.
- Re-run on band-set change or dataset change; compare two engine runs.

### 4. Deterministic Cohort Pay-Gap Analysis
- Raw (unadjusted) gap by gender, tenure bucket, level, geo, role-family, ethnicity.
- Adjusted gap controlling for explanatory factors (level, geo, tenure, performance) via deterministic linear decomposition.
- Explainable contribution decomposition: how much of the raw gap each factor explains vs the residual "unexplained" gap.
- Cohort builder: define arbitrary cohorts (any combination of attribute filters).
- Statistical context: cohort sizes, mean/median pay, gap in % and absolute currency.
- Drill-down from a gap figure to the contributing employees.
- Configurable reference group (e.g. men as reference for gender gap).
- Snapshotted, reproducible gap runs linked to a dataset version + band-set version.

### 5. Remediation Cost Simulator
- Given a target (close-to-min, close-to-mid, close compa-ratio to 1.0, close residual gap to X%), compute exact per-person adjustment.
- Total remediation budget, rolled up by cohort, level, geo, department.
- What-if scenarios: multiple saved scenarios with different targets/constraints.
- Constraints: max % raise per person, budget cap, exclude above-mid employees.
- Phasing: split remediation across N cycles; show per-cycle cost.
- Scenario comparison table (budget, headcount affected, residual gap after).
- Export the line-item adjustment list (who, current, proposed, delta, rationale).
- Sensitivity view: budget vs residual gap curve.

### 6. Offer-vs-Band Guardrails
- Enter a prospective new-hire offer (level, role, geo, proposed salary).
- Compute the offer's compa-ratio and range penetration against the live band set.
- Compression check: flag if the offer creates compression vs existing incumbents in the same band (offer >= or near incumbent pay despite less tenure/lower performance).
- Equity check: flag if the offer would widen an existing cohort gap.
- Guardrail rules engine: configurable thresholds (e.g. block above-mid offers, warn within X% of an incumbent).
- Offer log with decision (approved/declined/escalated) and reviewer.
- Suggested compliant offer range output.

### 7. Merit-Cycle Planner
- Define a merit cycle with a fixed raise budget pool.
- Allocation models: by compa-ratio (raise those lowest in band first), by performance, blended matrix (perf x compa-ratio).
- Per-employee recommended increase with running budget consumption.
- Manager overrides with budget guardrails.
- Model outcomes: post-cycle compa-ratio distribution and residual gap.
- Compare allocation models side by side.
- Lock and snapshot the cycle; export the increase list.
- Equity-aware mode: ensure the cycle does not widen any tracked cohort gap.

### 8. Audit Trail + Board / Evidence Pack
- Immutable, timestamped audit log of every band publish, dataset upload, engine run, gap run, scenario, and decision.
- Generate a board-ready evidence pack: methodology, dataset version, band version, gap findings, remediation budget, sign-offs.
- Exportable as structured JSON (and printable HTML) for pay-transparency filings.
- Evidence pack versioning and a shareable read-only link token.
- Attestation/sign-off workflow with named approvers and timestamps.
- Methodology appendix auto-generated from the actual settings used.

### 9. Dashboards & Analytics
- Compa-ratio distribution histogram (overall and per cohort).
- Gap-by-cohort bar/heat view (raw vs adjusted).
- Outlier board (below-min, above-max, off-target).
- Remediation budget summary tiles and trend.
- Headcount-by-band coverage view (employees with/without a matching band).
- KPI tiles: median compa-ratio, largest unexplained gap, total exposure.

### 10. Built-in Sample Seeder
- One synthetic org of ~80 employees across multiple levels, roles, and geos.
- A coherent band set with realistic min/mid/max.
- Deliberately planted below-min outliers and a measurable gender pay gap so compa-ratio, gap analysis, and remediation budget are immediately demoable.
- Idempotent: seeds only if the workspace dataset is empty.

### 11. Search, Tags & Saved Filters
- Global search across employees, bands, scenarios, offers.
- Tag any employee, band, scenario, or offer; filter by tag.
- Saved filters / segments reusable across analyses.

### 12. Bulk Actions
- Bulk tag, bulk re-map level/geo, bulk flag-clear, bulk include/exclude from a scenario.

### 13. Notifications
- In-app notifications for completed import jobs, new outliers detected, gap threshold breaches, scenario completion.
- Mark-read and notification preferences.

### 14. Webhooks
- Register outbound webhooks for events (import.completed, outlier.detected, gap.threshold_breached, scenario.created, evidence_pack.published).
- Delivery log with status and retry.

### 15. Public API + API Keys
- Issue/revoke API keys scoped to a workspace.
- Documented REST surface mirroring the app (read datasets, runs, gaps, scenarios).
- Per-key usage log.

### 16. Audit Log (System)
- Workspace-wide append-only activity log with actor, action, target, timestamp; filterable.

### 17. Settings
- Workspace profile, base currency, FX rates, default reference groups, gap thresholds, PII masking defaults, guardrail rules.

### 18. Onboarding
- Guided first-run: seed sample, design a band, run the engine, view the gap, build a remediation scenario.
- Progress checklist.

### 19. Billing (Free; Stripe optional 503)
- All features free for signed-in users.
- Plans (free/pro) and subscription records present; checkout/portal/webhook return 503 when Stripe is unconfigured.

### 20. Cohort & Segment Library
- Reusable named cohort definitions used by gap analysis and dashboards.
- Cohort membership preview and size.

### 21. Compression & Equity Rules Engine
- Centralized configurable rule definitions (thresholds for compression, off-target, gap breach) consumed by guardrails, engine, and notifications.

### 22. Reporting Exports
- CSV/JSON exports for employees, positioning, gaps, remediation line items, merit increases, and the evidence pack.

---

## Data Model (Tables)

- **workspaces** — id, name, owner_id, base_currency, created_at, updated_at.
- **datasets** — id, workspace_id, version, label, source, row_count, status, created_by, created_at.
- **employees** — id, dataset_id, workspace_id, employee_ref, name, level, role_family, geo, gender, ethnicity, tenure_months, hire_date, performance_rating, base_salary, currency, fte, tags, created_at.
- **band_sets** — id, workspace_id, version, label, effective_from, status, notes, created_by, created_at.
- **bands** — id, band_set_id, workspace_id, level, role_family, geo, currency, min_salary, mid_salary, max_salary, target_compa_low, target_compa_high, notes, created_at.
- **fx_rates** — id, workspace_id, from_currency, to_currency, rate, created_at.
- **engine_runs** — id, workspace_id, dataset_id, band_set_id, label, summary, status, created_by, created_at.
- **positionings** — id, engine_run_id, workspace_id, employee_id, band_id, compa_ratio, range_penetration, quartile, flags, base_salary_normalized, created_at.
- **cohorts** — id, workspace_id, name, definition, created_by, created_at.
- **gap_runs** — id, workspace_id, dataset_id, band_set_id, reference_group, summary, status, created_by, created_at.
- **gap_results** — id, gap_run_id, workspace_id, cohort_key, dimension, raw_gap_pct, adjusted_gap_pct, explained_pct, unexplained_pct, group_size, mean_pay, decomposition, created_at.
- **scenarios** — id, workspace_id, dataset_id, band_set_id, name, target_type, constraints, total_budget_cents, headcount_affected, residual_gap_pct, status, created_by, created_at.
- **scenario_adjustments** — id, scenario_id, workspace_id, employee_id, current_salary, proposed_salary, delta_cents, rationale, created_at.
- **offers** — id, workspace_id, band_set_id, candidate_label, level, role_family, geo, proposed_salary, currency, compa_ratio, range_penetration, flags, decision, reviewer, created_by, created_at.
- **merit_cycles** — id, workspace_id, dataset_id, band_set_id, name, budget_cents, model, status, summary, created_by, created_at.
- **merit_allocations** — id, merit_cycle_id, workspace_id, employee_id, current_salary, recommended_increase_cents, final_increase_cents, override_reason, created_at.
- **evidence_packs** — id, workspace_id, gap_run_id, scenario_id, band_set_id, title, methodology, contents, share_token, status, created_by, created_at.
- **attestations** — id, evidence_pack_id, workspace_id, approver_name, approver_id, attested_at, note, created_at.
- **guardrail_rules** — id, workspace_id, rule_type, threshold, action, enabled, created_at.
- **saved_filters** — id, workspace_id, name, target_type, definition, created_by, created_at.
- **tags** — id, workspace_id, name, color, created_at.
- **notifications** — id, workspace_id, user_id, type, title, body, read, created_at.
- **webhooks** — id, workspace_id, url, events, secret, enabled, created_at.
- **webhook_deliveries** — id, webhook_id, workspace_id, event, status, response_code, created_at.
- **api_keys** — id, workspace_id, name, key_prefix, key_hash, last_used_at, revoked, created_by, created_at.
- **audit_log** — id, workspace_id, actor_id, action, target_type, target_id, metadata, created_at.
- **settings** — id, workspace_id (unique), base_currency, default_reference_group, gap_threshold_pct, pii_masking, created_at, updated_at.
- **plans** — id (text: 'free'/'pro'), name, price_cents.
- **subscriptions** — id, user_id (unique), plan_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, created_at, updated_at.

---

## API Surface (mounted under /api/v1)

workspaces, datasets, employees, bandsets, bands, fxrates, engine, positionings, cohorts, gaps, scenarios, offers, merit, evidence, attestations, guardrails, filters, tags, notifications, webhooks, apikeys, auditlog, settings, dashboard, sample, billing.

---

## Frontend Pages (~24)

Public: landing, sign-in, sign-up, pricing.
Dashboard: overview, datasets, dataset detail, bands, band detail, positioning/compa-ratio, gaps, gap detail, cohorts, scenarios, scenario detail, offers, merit cycles, merit detail, evidence packs, evidence detail, analytics, webhooks, API keys, audit log, notifications, settings, onboarding.
