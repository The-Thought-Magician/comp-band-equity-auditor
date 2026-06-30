# CompBandEquityAuditor — Authoritative Build Plan

This is the single source of truth. Filenames, mount paths, api method names, and page file paths declared here are BINDING. Every api method maps 1:1 to exactly one backend endpoint and is consumed by at least one page.

Stack: Hono 4.12.27 backend (mounted under `/api/v1`), drizzle-orm 0.45.2 + Neon, Next.js ^16.2.9 frontend. Auth: `@neondatabase/auth` 0.4.2-beta, `web/proxy.ts` only. Backend trusts `X-User-Id`, handlers use `getUserId(c)`. Frontend calls `fetch('/api/proxy/<path>')` mapping 1:1 to `/api/v1/<path>`. Public reads / auth-gated writes with zod + ownership checks. Every route file `export default router`.

Workspace model: each user gets one workspace (auto-provisioned on first authed call via a `requireWorkspace(userId)` helper). All domain rows carry `workspace_id`; ownership checks compare a row's `workspace_id` to the caller's workspace.

---

## (a) Tables (columns)

- **workspaces** — id, name, owner_id, base_currency, created_at, updated_at
- **datasets** — id, workspace_id(FK), version, label, source, row_count, rejected_rows(jsonb), status, created_by, created_at
- **employees** — id, dataset_id(FK), workspace_id(FK), employee_ref, name, level, role_family, geo, gender, ethnicity, tenure_months, hire_date, performance_rating(real), base_salary(real), currency, fte(real), tags(jsonb), created_at
- **fx_rates** — id, workspace_id(FK), from_currency, to_currency, rate(real), created_at; UNIQUE(workspace_id, from_currency, to_currency)
- **band_sets** — id, workspace_id(FK), version, label, effective_from, status, notes, created_by, created_at
- **bands** — id, band_set_id(FK), workspace_id(FK), level, role_family, geo, currency, min_salary(real), mid_salary(real), max_salary(real), target_compa_low(real), target_compa_high(real), notes, created_at; UNIQUE(band_set_id, level, role_family, geo)
- **engine_runs** — id, workspace_id(FK), dataset_id(FK), band_set_id(FK), label, summary(jsonb), status, created_by, created_at
- **positionings** — id, engine_run_id(FK), workspace_id(FK), employee_id(FK), band_id(FK,null), compa_ratio(real), range_penetration(real), quartile, flags(jsonb), base_salary_normalized(real), created_at
- **cohorts** — id, workspace_id(FK), name, definition(jsonb), created_by, created_at
- **gap_runs** — id, workspace_id(FK), dataset_id(FK), band_set_id(FK,null), reference_group, summary(jsonb), status, created_by, created_at
- **gap_results** — id, gap_run_id(FK), workspace_id(FK), cohort_key, dimension, raw_gap_pct(real), adjusted_gap_pct(real), explained_pct(real), unexplained_pct(real), group_size, mean_pay(real), decomposition(jsonb), created_at
- **scenarios** — id, workspace_id(FK), dataset_id(FK), band_set_id(FK), name, target_type, constraints(jsonb), total_budget_cents, headcount_affected, residual_gap_pct(real), status, created_by, created_at
- **scenario_adjustments** — id, scenario_id(FK), workspace_id(FK), employee_id(FK), current_salary(real), proposed_salary(real), delta_cents, rationale, created_at
- **offers** — id, workspace_id(FK), band_set_id(FK), candidate_label, level, role_family, geo, proposed_salary(real), currency, compa_ratio(real), range_penetration(real), flags(jsonb), decision, reviewer, created_by, created_at
- **merit_cycles** — id, workspace_id(FK), dataset_id(FK), band_set_id(FK), name, budget_cents, model, status, summary(jsonb), created_by, created_at
- **merit_allocations** — id, merit_cycle_id(FK), workspace_id(FK), employee_id(FK), current_salary(real), recommended_increase_cents, final_increase_cents, override_reason, created_at
- **evidence_packs** — id, workspace_id(FK), gap_run_id(FK,null), scenario_id(FK,null), band_set_id(FK,null), title, methodology, contents(jsonb), share_token(unique), status, created_by, created_at
- **attestations** — id, evidence_pack_id(FK), workspace_id(FK), approver_name, approver_id, attested_at, note, created_at
- **guardrail_rules** — id, workspace_id(FK), rule_type, threshold(real), action, enabled(bool), created_at
- **saved_filters** — id, workspace_id(FK), name, target_type, definition(jsonb), created_by, created_at
- **tags** — id, workspace_id(FK), name, color, created_at; UNIQUE(workspace_id, name)
- **notifications** — id, workspace_id(FK), user_id, type, title, body, read(bool), created_at
- **webhooks** — id, workspace_id(FK), url, events(jsonb), secret, enabled(bool), created_by, created_at
- **webhook_deliveries** — id, webhook_id(FK), workspace_id(FK), event, status, response_code, created_at
- **api_keys** — id, workspace_id(FK), name, key_prefix, key_hash, last_used_at, revoked(bool), created_by, created_at
- **audit_log** — id, workspace_id(FK), actor_id, action, target_type, target_id, metadata(jsonb), created_at
- **settings** — id, workspace_id(FK,unique), base_currency, default_reference_group, gap_threshold_pct(real), pii_masking(bool), created_at, updated_at
- **plans** — id(text 'free'/'pro'), name, price_cents
- **subscriptions** — id, user_id(unique), plan_id(text), stripe_customer_id, stripe_subscription_id, status, current_period_end, created_at, updated_at

---

## (b) Backend route files (mounted under /api/v1)

Conventions per file: `const router = new Hono()`, zod-validated writes, `authMiddleware` on writes, `getUserId(c)` + `requireWorkspace(userId)` for scoping, ownership checks on mutate, `export default router`. Public reads return arrays/objects; writes return the created/updated row.

### 1. `workspaces.ts` → mount `workspaces`
- GET `/me` — auth — current user's workspace (auto-create if absent) — `Workspace`
- PUT `/me` — auth — update name/base_currency — `Workspace`

### 2. `datasets.ts` → mount `datasets`
- GET `/` — public(read, workspace-scoped via header) — list dataset versions — `Dataset[]`
- GET `/:id` — public — dataset detail + row_count + rejected_rows — `Dataset`
- POST `/` — auth — create dataset version + insert employee rows (validates rows, records rejects) — `Dataset`
- POST `/:id/validate` — auth — re-run validation, return errors — `{ valid, errors[] }`
- DELETE `/:id` — auth+owner — delete dataset + its employees — `{ success }`
- GET `/:id/diff/:otherId` — public — diff two dataset versions — `{ added, removed, changed }`

### 3. `employees.ts` → mount `employees`
- GET `/` — public — list employees (filter by dataset_id, level, geo, gender, tag query) — `Employee[]`
- GET `/:id` — public — employee detail — `Employee`
- PUT `/:id` — auth+owner — edit a normalized field (level/geo/role_family/salary) — `Employee`
- POST `/bulk-tag` — auth — bulk add/remove tags on employee ids — `{ updated }`
- POST `/bulk-remap` — auth — bulk set level/geo on employee ids — `{ updated }`

### 4. `bandsets.ts` → mount `bandsets`
- GET `/` — public — list band-set versions — `BandSet[]`
- GET `/:id` — public — band-set detail (with bands) — `BandSet & { bands }`
- POST `/` — auth — create band-set version — `BandSet`
- POST `/:id/publish` — auth+owner — mark status published (immutable) — `BandSet`
- POST `/:id/clone` — auth — clone band-set + its bands into a new version — `BandSet`
- GET `/:id/diff/:otherId` — public — diff two band-set versions — `{ added, removed, changed }`
- GET `/:id/lint` — public — overlap/inversion lint findings — `{ findings[] }`
- DELETE `/:id` — auth+owner — delete band-set + bands — `{ success }`

### 5. `bands.ts` → mount `bands`
- GET `/` — public — list bands (filter band_set_id) — `Band[]`
- POST `/` — auth — create band in a band-set — `Band`
- PUT `/:id` — auth+owner — edit min/mid/max/target — `Band`
- DELETE `/:id` — auth+owner — delete band — `{ success }`
- POST `/bulk` — auth — bulk-import band rows into a band-set — `{ created }`

### 6. `fxrates.ts` → mount `fxrates`
- GET `/` — public — list FX rates — `FxRate[]`
- POST `/` — auth — upsert an FX rate — `FxRate`
- DELETE `/:id` — auth+owner — delete an FX rate — `{ success }`

### 7. `engine.ts` → mount `engine`
- GET `/runs` — public — list engine runs — `EngineRun[]`
- GET `/runs/:id` — public — engine run detail + summary — `EngineRun`
- POST `/runs` — auth — run compa-ratio engine for (dataset_id, band_set_id): compute positionings + summary — `EngineRun`
- DELETE `/runs/:id` — auth+owner — delete run + positionings — `{ success }`

### 8. `positionings.ts` → mount `positionings`
- GET `/` — public — list positionings for an engine_run_id (filter flags) — `Positioning[]`
- GET `/:id` — public — single positioning with band + employee + math shown — `Positioning`
- GET `/distribution` — public — compa-ratio distribution buckets for a run (filter cohort) — `{ buckets[], stats }`

### 9. `cohorts.ts` → mount `cohorts`
- GET `/` — public — list cohorts — `Cohort[]`
- GET `/:id` — public — cohort detail + membership preview against a dataset — `Cohort & { size, sample }`
- POST `/` — auth — create cohort definition — `Cohort`
- PUT `/:id` — auth+owner — update definition — `Cohort`
- DELETE `/:id` — auth+owner — delete cohort — `{ success }`

### 10. `gaps.ts` → mount `gaps`
- GET `/runs` — public — list gap runs — `GapRun[]`
- GET `/runs/:id` — public — gap run + all gap_results — `GapRun & { results }`
- POST `/runs` — auth — run gap analysis (dataset_id, dimensions, reference_group): raw+adjusted+decomposition — `GapRun & { results }`
- GET `/runs/:id/results` — public — gap_results for a run (filter dimension) — `GapResult[]`
- GET `/runs/:id/drilldown` — public — employees contributing to a cohort_key/dimension — `Employee[]`
- DELETE `/runs/:id` — auth+owner — delete gap run + results — `{ success }`

### 11. `scenarios.ts` → mount `scenarios`
- GET `/` — public — list scenarios — `Scenario[]`
- GET `/:id` — public — scenario + adjustments — `Scenario & { adjustments }`
- POST `/` — auth — build scenario (target_type, constraints): compute per-person adjustments + budget + residual gap — `Scenario & { adjustments }`
- GET `/compare` — public — compare scenarios by ids — `{ rows[] }`
- GET `/:id/sensitivity` — public — budget-vs-residual-gap curve — `{ points[] }`
- DELETE `/:id` — auth+owner — delete scenario + adjustments — `{ success }`

### 12. `offers.ts` → mount `offers`
- GET `/` — public — list offers — `Offer[]`
- GET `/:id` — public — offer detail — `Offer`
- POST `/evaluate` — auth — evaluate prospective offer vs live band set (compa-ratio, compression, equity flags, suggested range) without saving — `{ compa_ratio, range_penetration, flags, suggested_range }`
- POST `/` — auth — save evaluated offer — `Offer`
- PUT `/:id/decision` — auth+owner — set decision + reviewer — `Offer`
- DELETE `/:id` — auth+owner — delete offer — `{ success }`

### 13. `merit.ts` → mount `merit`
- GET `/` — public — list merit cycles — `MeritCycle[]`
- GET `/:id` — public — merit cycle + allocations — `MeritCycle & { allocations }`
- POST `/` — auth — create merit cycle + compute allocations for model+budget — `MeritCycle & { allocations }`
- PUT `/:id/allocations/:allocId` — auth+owner — manager override final_increase — `MeritAllocation`
- POST `/:id/lock` — auth+owner — lock + snapshot cycle, store post-cycle summary — `MeritCycle`
- GET `/:id/compare` — public — compare allocation models for the cycle's inputs — `{ models[] }`
- DELETE `/:id` — auth+owner — delete cycle + allocations — `{ success }`

### 14. `evidence.ts` → mount `evidence`
- GET `/` — public — list evidence packs — `EvidencePack[]`
- GET `/:id` — public — evidence pack detail (contents + methodology) — `EvidencePack`
- POST `/` — auth — generate evidence pack from gap_run/scenario/band_set (auto methodology) — `EvidencePack`
- POST `/:id/publish` — auth+owner — publish + mint share_token — `EvidencePack`
- GET `/shared/:token` — public — read-only pack by share token — `EvidencePack`
- DELETE `/:id` — auth+owner — delete pack — `{ success }`

### 15. `attestations.ts` → mount `attestations`
- GET `/` — public — list attestations (filter evidence_pack_id) — `Attestation[]`
- POST `/` — auth — add sign-off to a pack — `Attestation`
- DELETE `/:id` — auth+owner — remove attestation — `{ success }`

### 16. `guardrails.ts` → mount `guardrails`
- GET `/` — public — list guardrail rules — `GuardrailRule[]`
- POST `/` — auth — create rule — `GuardrailRule`
- PUT `/:id` — auth+owner — update threshold/action/enabled — `GuardrailRule`
- DELETE `/:id` — auth+owner — delete rule — `{ success }`

### 17. `filters.ts` → mount `filters`
- GET `/` — public — list saved filters (filter target_type) — `SavedFilter[]`
- POST `/` — auth — create saved filter — `SavedFilter`
- DELETE `/:id` — auth+owner — delete saved filter — `{ success }`

### 18. `tags.ts` → mount `tags`
- GET `/` — public — list tags — `Tag[]`
- POST `/` — auth — create tag — `Tag`
- DELETE `/:id` — auth+owner — delete tag — `{ success }`

### 19. `notifications.ts` → mount `notifications`
- GET `/` — auth — list current user's notifications — `Notification[]`
- POST `/:id/read` — auth — mark read — `Notification`
- POST `/read-all` — auth — mark all read — `{ updated }`

### 20. `webhooks.ts` → mount `webhooks`
- GET `/` — public — list webhooks — `Webhook[]`
- POST `/` — auth — register webhook — `Webhook`
- PUT `/:id` — auth+owner — update url/events/enabled — `Webhook`
- DELETE `/:id` — auth+owner — delete webhook — `{ success }`
- GET `/:id/deliveries` — public — delivery log — `WebhookDelivery[]`

### 21. `apikeys.ts` → mount `apikeys`
- GET `/` — public — list API keys (prefix only, never hash) — `ApiKey[]`
- POST `/` — auth — issue key (returns plaintext once) — `{ key, record }`
- POST `/:id/revoke` — auth+owner — revoke key — `ApiKey`
- DELETE `/:id` — auth+owner — delete key — `{ success }`

### 22. `auditlog.ts` → mount `auditlog`
- GET `/` — public — paginated workspace audit log (filter action/target_type) — `AuditEntry[]`

### 23. `settings.ts` → mount `settings`
- GET `/` — auth — get workspace settings (auto-create defaults) — `Settings`
- PUT `/` — auth — update settings — `Settings`

### 24. `dashboard.ts` → mount `dashboard`
- GET `/summary` — public — KPI tiles (median compa-ratio, largest unexplained gap, total exposure, outlier count, headcount, band coverage) — `{ tiles }`
- GET `/outliers` — public — outlier board from latest engine run — `{ outliers[] }`
- GET `/analytics` — public — gap-by-cohort + compa distribution + budget trend series — `{ gapByCohort, compaDistribution, budgetTrend }`

### 25. `sample.ts` → mount `sample`
- POST `/seed` — auth — seed the synthetic ~80-employee org (dataset + band set + planted outliers + gender gap) into the caller's workspace if empty — `{ seeded, dataset_id, band_set_id }`
- GET `/status` — public — whether sample/any data exists — `{ hasData }`

### 26. `billing.ts` → mount `billing`
- GET `/plan` — public(header user) — subscription + plan + stripeEnabled — `{ subscription, plan, stripeEnabled }`
- POST `/checkout` — auth — Stripe checkout or 503 — `{ url } | 503`
- POST `/portal` — auth — Stripe portal or 503 — `{ url } | 503`
- POST `/webhook` — public — Stripe webhook or 503 — `{ received } | 503`

---

## (c) lib/api.ts methods (web/lib/api.ts)

Each is `fetch('/api/proxy/<path>')`; mutations send `Content-Type: application/json` + `JSON.stringify`. `export default api`.

| Method | Path | Verb |
|---|---|---|
| getWorkspace | `/api/proxy/workspaces/me` | GET |
| updateWorkspace | `/api/proxy/workspaces/me` | PUT |
| getDatasets | `/api/proxy/datasets` | GET |
| getDataset | `/api/proxy/datasets/:id` | GET |
| createDataset | `/api/proxy/datasets` | POST |
| validateDataset | `/api/proxy/datasets/:id/validate` | POST |
| deleteDataset | `/api/proxy/datasets/:id` | DELETE |
| diffDatasets | `/api/proxy/datasets/:id/diff/:otherId` | GET |
| getEmployees | `/api/proxy/employees` | GET |
| getEmployee | `/api/proxy/employees/:id` | GET |
| updateEmployee | `/api/proxy/employees/:id` | PUT |
| bulkTagEmployees | `/api/proxy/employees/bulk-tag` | POST |
| bulkRemapEmployees | `/api/proxy/employees/bulk-remap` | POST |
| getBandSets | `/api/proxy/bandsets` | GET |
| getBandSet | `/api/proxy/bandsets/:id` | GET |
| createBandSet | `/api/proxy/bandsets` | POST |
| publishBandSet | `/api/proxy/bandsets/:id/publish` | POST |
| cloneBandSet | `/api/proxy/bandsets/:id/clone` | POST |
| diffBandSets | `/api/proxy/bandsets/:id/diff/:otherId` | GET |
| lintBandSet | `/api/proxy/bandsets/:id/lint` | GET |
| deleteBandSet | `/api/proxy/bandsets/:id` | DELETE |
| getBands | `/api/proxy/bands` | GET |
| createBand | `/api/proxy/bands` | POST |
| updateBand | `/api/proxy/bands/:id` | PUT |
| deleteBand | `/api/proxy/bands/:id` | DELETE |
| bulkCreateBands | `/api/proxy/bands/bulk` | POST |
| getFxRates | `/api/proxy/fxrates` | GET |
| upsertFxRate | `/api/proxy/fxrates` | POST |
| deleteFxRate | `/api/proxy/fxrates/:id` | DELETE |
| getEngineRuns | `/api/proxy/engine/runs` | GET |
| getEngineRun | `/api/proxy/engine/runs/:id` | GET |
| createEngineRun | `/api/proxy/engine/runs` | POST |
| deleteEngineRun | `/api/proxy/engine/runs/:id` | DELETE |
| getPositionings | `/api/proxy/positionings` | GET |
| getPositioning | `/api/proxy/positionings/:id` | GET |
| getCompaDistribution | `/api/proxy/positionings/distribution` | GET |
| getCohorts | `/api/proxy/cohorts` | GET |
| getCohort | `/api/proxy/cohorts/:id` | GET |
| createCohort | `/api/proxy/cohorts` | POST |
| updateCohort | `/api/proxy/cohorts/:id` | PUT |
| deleteCohort | `/api/proxy/cohorts/:id` | DELETE |
| getGapRuns | `/api/proxy/gaps/runs` | GET |
| getGapRun | `/api/proxy/gaps/runs/:id` | GET |
| createGapRun | `/api/proxy/gaps/runs` | POST |
| getGapResults | `/api/proxy/gaps/runs/:id/results` | GET |
| getGapDrilldown | `/api/proxy/gaps/runs/:id/drilldown` | GET |
| deleteGapRun | `/api/proxy/gaps/runs/:id` | DELETE |
| getScenarios | `/api/proxy/scenarios` | GET |
| getScenario | `/api/proxy/scenarios/:id` | GET |
| createScenario | `/api/proxy/scenarios` | POST |
| compareScenarios | `/api/proxy/scenarios/compare` | GET |
| getScenarioSensitivity | `/api/proxy/scenarios/:id/sensitivity` | GET |
| deleteScenario | `/api/proxy/scenarios/:id` | DELETE |
| getOffers | `/api/proxy/offers` | GET |
| getOffer | `/api/proxy/offers/:id` | GET |
| evaluateOffer | `/api/proxy/offers/evaluate` | POST |
| createOffer | `/api/proxy/offers` | POST |
| decideOffer | `/api/proxy/offers/:id/decision` | PUT |
| deleteOffer | `/api/proxy/offers/:id` | DELETE |
| getMeritCycles | `/api/proxy/merit` | GET |
| getMeritCycle | `/api/proxy/merit/:id` | GET |
| createMeritCycle | `/api/proxy/merit` | POST |
| overrideMeritAllocation | `/api/proxy/merit/:id/allocations/:allocId` | PUT |
| lockMeritCycle | `/api/proxy/merit/:id/lock` | POST |
| compareMeritModels | `/api/proxy/merit/:id/compare` | GET |
| deleteMeritCycle | `/api/proxy/merit/:id` | DELETE |
| getEvidencePacks | `/api/proxy/evidence` | GET |
| getEvidencePack | `/api/proxy/evidence/:id` | GET |
| createEvidencePack | `/api/proxy/evidence` | POST |
| publishEvidencePack | `/api/proxy/evidence/:id/publish` | POST |
| getSharedEvidencePack | `/api/proxy/evidence/shared/:token` | GET |
| deleteEvidencePack | `/api/proxy/evidence/:id` | DELETE |
| getAttestations | `/api/proxy/attestations` | GET |
| createAttestation | `/api/proxy/attestations` | POST |
| deleteAttestation | `/api/proxy/attestations/:id` | DELETE |
| getGuardrails | `/api/proxy/guardrails` | GET |
| createGuardrail | `/api/proxy/guardrails` | POST |
| updateGuardrail | `/api/proxy/guardrails/:id` | PUT |
| deleteGuardrail | `/api/proxy/guardrails/:id` | DELETE |
| getSavedFilters | `/api/proxy/filters` | GET |
| createSavedFilter | `/api/proxy/filters` | POST |
| deleteSavedFilter | `/api/proxy/filters/:id` | DELETE |
| getTags | `/api/proxy/tags` | GET |
| createTag | `/api/proxy/tags` | POST |
| deleteTag | `/api/proxy/tags/:id` | DELETE |
| getNotifications | `/api/proxy/notifications` | GET |
| markNotificationRead | `/api/proxy/notifications/:id/read` | POST |
| markAllNotificationsRead | `/api/proxy/notifications/read-all` | POST |
| getWebhooks | `/api/proxy/webhooks` | GET |
| createWebhook | `/api/proxy/webhooks` | POST |
| updateWebhook | `/api/proxy/webhooks/:id` | PUT |
| deleteWebhook | `/api/proxy/webhooks/:id` | DELETE |
| getWebhookDeliveries | `/api/proxy/webhooks/:id/deliveries` | GET |
| getApiKeys | `/api/proxy/apikeys` | GET |
| createApiKey | `/api/proxy/apikeys` | POST |
| revokeApiKey | `/api/proxy/apikeys/:id/revoke` | POST |
| deleteApiKey | `/api/proxy/apikeys/:id` | DELETE |
| getAuditLog | `/api/proxy/auditlog` | GET |
| getSettings | `/api/proxy/settings` | GET |
| updateSettings | `/api/proxy/settings` | PUT |
| getDashboardSummary | `/api/proxy/dashboard/summary` | GET |
| getDashboardOutliers | `/api/proxy/dashboard/outliers` | GET |
| getDashboardAnalytics | `/api/proxy/dashboard/analytics` | GET |
| seedSample | `/api/proxy/sample/seed` | POST |
| getSampleStatus | `/api/proxy/sample/status` | GET |
| getBillingPlan | `/api/proxy/billing/plan` | GET |
| startCheckout | `/api/proxy/billing/checkout` | POST |
| openBillingPortal | `/api/proxy/billing/portal` | POST |

---

## (d) Pages (web/app)

Kind = public (static or auth-page, no dashboard chrome) | dashboard (wrapped by `web/app/dashboard/layout.tsx` → `DashboardLayout`).

| Route | File | Kind | API methods used | Renders |
|---|---|---|---|---|
| `/` | `app/page.tsx` | public | none | Static landing: hero, feature grid, CTAs. No auth calls. |
| `/auth/sign-in` | `app/auth/sign-in/page.tsx` | public | none (authClient) | Email/password sign-in. |
| `/auth/sign-up` | `app/auth/sign-up/page.tsx` | public | none (authClient) | Email/password sign-up. |
| `/pricing` | `app/pricing/page.tsx` | public | getBillingPlan | Free vs Pro tiers; Pro shows 503-aware CTA. |
| `/dashboard` | `app/dashboard/page.tsx` | dashboard | getDashboardSummary, getDashboardOutliers, getSampleStatus, seedSample | KPI tiles, outlier board, seed-sample CTA when empty. |
| `/dashboard/datasets` | `app/dashboard/datasets/page.tsx` | dashboard | getDatasets, createDataset, deleteDataset, diffDatasets | Dataset version list, CSV/JSON upload + column-map, diff. |
| `/dashboard/datasets/[id]` | `app/dashboard/datasets/[id]/page.tsx` | dashboard | getDataset, getEmployees, validateDataset, updateEmployee, bulkTagEmployees, bulkRemapEmployees | Dataset detail, employee table, validation errors, bulk actions. |
| `/dashboard/bands` | `app/dashboard/bands/page.tsx` | dashboard | getBandSets, createBandSet, cloneBandSet, publishBandSet, deleteBandSet, diffBandSets | Band-set versions, create/clone/publish, version diff. |
| `/dashboard/bands/[id]` | `app/dashboard/bands/[id]/page.tsx` | dashboard | getBandSet, getBands, createBand, updateBand, deleteBand, bulkCreateBands, lintBandSet | Band grid editor, bulk import, lint findings. |
| `/dashboard/positioning` | `app/dashboard/positioning/page.tsx` | dashboard | getEngineRuns, createEngineRun, getEngineRun, deleteEngineRun, getPositionings, getCompaDistribution | Run engine, compa-ratio table, distribution histogram, flags. |
| `/dashboard/gaps` | `app/dashboard/gaps/page.tsx` | dashboard | getGapRuns, createGapRun, deleteGapRun | Gap runs list, launch new gap analysis. |
| `/dashboard/gaps/[id]` | `app/dashboard/gaps/[id]/page.tsx` | dashboard | getGapRun, getGapResults, getGapDrilldown | Raw vs adjusted gap, decomposition, drill-down. |
| `/dashboard/cohorts` | `app/dashboard/cohorts/page.tsx` | dashboard | getCohorts, getCohort, createCohort, updateCohort, deleteCohort | Cohort builder, membership preview. |
| `/dashboard/scenarios` | `app/dashboard/scenarios/page.tsx` | dashboard | getScenarios, createScenario, compareScenarios, deleteScenario | Scenario list, new what-if, comparison table. |
| `/dashboard/scenarios/[id]` | `app/dashboard/scenarios/[id]/page.tsx` | dashboard | getScenario, getScenarioSensitivity | Line-item adjustments, budget, sensitivity curve. |
| `/dashboard/offers` | `app/dashboard/offers/page.tsx` | dashboard | getOffers, evaluateOffer, createOffer, decideOffer, deleteOffer | Offer evaluator, compression/equity flags, decision log. |
| `/dashboard/merit` | `app/dashboard/merit/page.tsx` | dashboard | getMeritCycles, createMeritCycle, deleteMeritCycle | Merit cycle list, create with budget + model. |
| `/dashboard/merit/[id]` | `app/dashboard/merit/[id]/page.tsx` | dashboard | getMeritCycle, overrideMeritAllocation, lockMeritCycle, compareMeritModels | Allocation table, overrides, model compare, lock. |
| `/dashboard/evidence` | `app/dashboard/evidence/page.tsx` | dashboard | getEvidencePacks, createEvidencePack, publishEvidencePack, deleteEvidencePack | Evidence pack list, generate/publish, share token. |
| `/dashboard/evidence/[id]` | `app/dashboard/evidence/[id]/page.tsx` | dashboard | getEvidencePack, getAttestations, createAttestation, deleteAttestation | Pack contents, methodology, sign-off workflow. |
| `/dashboard/analytics` | `app/dashboard/analytics/page.tsx` | dashboard | getDashboardAnalytics, getGuardrails, createGuardrail, updateGuardrail, deleteGuardrail | Gap-by-cohort, compa distribution, budget trend, guardrail rules. |
| `/dashboard/webhooks` | `app/dashboard/webhooks/page.tsx` | dashboard | getWebhooks, createWebhook, updateWebhook, deleteWebhook, getWebhookDeliveries | Webhook registry, delivery log. |
| `/dashboard/api-keys` | `app/dashboard/api-keys/page.tsx` | dashboard | getApiKeys, createApiKey, revokeApiKey, deleteApiKey | API key issue/revoke, one-time plaintext. |
| `/dashboard/audit-log` | `app/dashboard/audit-log/page.tsx` | dashboard | getAuditLog, getSavedFilters, createSavedFilter, deleteSavedFilter | Activity log, saved filters. |
| `/dashboard/notifications` | `app/dashboard/notifications/page.tsx` | dashboard | getNotifications, markNotificationRead, markAllNotificationsRead | Notification inbox. |
| `/dashboard/settings` | `app/dashboard/settings/page.tsx` | dashboard | getSettings, updateSettings, getWorkspace, updateWorkspace, getFxRates, upsertFxRate, deleteFxRate, getTags, createTag, deleteTag, getBillingPlan, startCheckout, openBillingPortal | Workspace + comp settings, FX rates, tags, billing. |
| `/dashboard/onboarding` | `app/dashboard/onboarding/page.tsx` | dashboard | getSampleStatus, seedSample, getDatasets, getBandSets, getEngineRuns, getGapRuns | Guided checklist: seed → band → engine → gap → scenario. |

Total: 4 public + 22 dashboard = 26 pages (plus 2 route handlers: `app/api/auth/[...path]/route.ts`, `app/api/proxy/[...path]/route.ts`).

---

## (e) DashboardLayout sidebar nav sections

`web/components/DashboardLayout.tsx` ('use client', active state via `usePathname()`), grouped:

- **Overview**
  - Dashboard → `/dashboard`
  - Analytics → `/dashboard/analytics`
- **Data**
  - Datasets → `/dashboard/datasets`
  - Comp Bands → `/dashboard/bands`
- **Audit**
  - Positioning → `/dashboard/positioning`
  - Pay Gaps → `/dashboard/gaps`
  - Cohorts → `/dashboard/cohorts`
- **Remediation**
  - Scenarios → `/dashboard/scenarios`
  - Offer Guardrails → `/dashboard/offers`
  - Merit Cycles → `/dashboard/merit`
- **Reporting**
  - Evidence Packs → `/dashboard/evidence`
  - Audit Log → `/dashboard/audit-log`
- **Workspace**
  - Webhooks → `/dashboard/webhooks`
  - API Keys → `/dashboard/api-keys`
  - Notifications → `/dashboard/notifications`
  - Settings → `/dashboard/settings`
  - Onboarding → `/dashboard/onboarding`

`web/app/dashboard/layout.tsx` renders `<DashboardLayout>{children}</DashboardLayout>`. Session guarding via `proxy.ts` matcher (`/dashboard/:path*`, `/settings/:path*`) + per-page `authClient.getSession()` checks.
