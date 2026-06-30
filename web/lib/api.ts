// Same-origin relative calls to /api/proxy/<path>, mapping 1:1 to backend /api/v1/<path>.
// The proxy route resolves the session and injects X-User-Id. Mutations send JSON.

async function jget(path: string) {
  const r = await fetch(path)
  if (!r.ok) throw new Error((await r.text()) || `GET ${path} failed (${r.status})`)
  return r.json()
}

async function jsend(method: string, path: string, body?: unknown) {
  const r = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!r.ok) throw new Error((await r.text()) || `${method} ${path} failed (${r.status})`)
  return r.json()
}

function qs(params?: Record<string, string | number | boolean | undefined | null>): string {
  if (!params) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

const api = {
  // Workspace
  getWorkspace: () => jget('/api/proxy/workspaces/me'),
  updateWorkspace: (data: unknown) => jsend('PUT', '/api/proxy/workspaces/me', data),

  // Datasets
  getDatasets: () => jget('/api/proxy/datasets'),
  getDataset: (id: string) => jget(`/api/proxy/datasets/${id}`),
  createDataset: (data: unknown) => jsend('POST', '/api/proxy/datasets', data),
  validateDataset: (id: string, data?: unknown) => jsend('POST', `/api/proxy/datasets/${id}/validate`, data ?? {}),
  deleteDataset: (id: string) => jsend('DELETE', `/api/proxy/datasets/${id}`),
  diffDatasets: (id: string, otherId: string) => jget(`/api/proxy/datasets/${id}/diff/${otherId}`),

  // Employees
  getEmployees: (params?: Record<string, string | number | boolean | undefined>) =>
    jget(`/api/proxy/employees${qs(params)}`),
  getEmployee: (id: string) => jget(`/api/proxy/employees/${id}`),
  updateEmployee: (id: string, data: unknown) => jsend('PUT', `/api/proxy/employees/${id}`, data),
  bulkTagEmployees: (data: unknown) => jsend('POST', '/api/proxy/employees/bulk-tag', data),
  bulkRemapEmployees: (data: unknown) => jsend('POST', '/api/proxy/employees/bulk-remap', data),

  // Band sets
  getBandSets: () => jget('/api/proxy/bandsets'),
  getBandSet: (id: string) => jget(`/api/proxy/bandsets/${id}`),
  createBandSet: (data: unknown) => jsend('POST', '/api/proxy/bandsets', data),
  publishBandSet: (id: string) => jsend('POST', `/api/proxy/bandsets/${id}/publish`, {}),
  cloneBandSet: (id: string, data?: unknown) => jsend('POST', `/api/proxy/bandsets/${id}/clone`, data ?? {}),
  diffBandSets: (id: string, otherId: string) => jget(`/api/proxy/bandsets/${id}/diff/${otherId}`),
  lintBandSet: (id: string) => jget(`/api/proxy/bandsets/${id}/lint`),
  deleteBandSet: (id: string) => jsend('DELETE', `/api/proxy/bandsets/${id}`),

  // Bands
  getBands: (params?: Record<string, string | number | undefined>) => jget(`/api/proxy/bands${qs(params)}`),
  createBand: (data: unknown) => jsend('POST', '/api/proxy/bands', data),
  updateBand: (id: string, data: unknown) => jsend('PUT', `/api/proxy/bands/${id}`, data),
  deleteBand: (id: string) => jsend('DELETE', `/api/proxy/bands/${id}`),
  bulkCreateBands: (data: unknown) => jsend('POST', '/api/proxy/bands/bulk', data),

  // FX rates
  getFxRates: () => jget('/api/proxy/fxrates'),
  upsertFxRate: (data: unknown) => jsend('POST', '/api/proxy/fxrates', data),
  deleteFxRate: (id: string) => jsend('DELETE', `/api/proxy/fxrates/${id}`),

  // Engine
  getEngineRuns: () => jget('/api/proxy/engine/runs'),
  getEngineRun: (id: string) => jget(`/api/proxy/engine/runs/${id}`),
  createEngineRun: (data: unknown) => jsend('POST', '/api/proxy/engine/runs', data),
  deleteEngineRun: (id: string) => jsend('DELETE', `/api/proxy/engine/runs/${id}`),

  // Positionings
  getPositionings: (params?: Record<string, string | number | undefined>) =>
    jget(`/api/proxy/positionings${qs(params)}`),
  getPositioning: (id: string) => jget(`/api/proxy/positionings/${id}`),
  getCompaDistribution: (params?: Record<string, string | number | undefined>) =>
    jget(`/api/proxy/positionings/distribution${qs(params)}`),

  // Cohorts
  getCohorts: () => jget('/api/proxy/cohorts'),
  getCohort: (id: string, params?: Record<string, string | undefined>) =>
    jget(`/api/proxy/cohorts/${id}${qs(params)}`),
  createCohort: (data: unknown) => jsend('POST', '/api/proxy/cohorts', data),
  updateCohort: (id: string, data: unknown) => jsend('PUT', `/api/proxy/cohorts/${id}`, data),
  deleteCohort: (id: string) => jsend('DELETE', `/api/proxy/cohorts/${id}`),

  // Gaps
  getGapRuns: () => jget('/api/proxy/gaps/runs'),
  getGapRun: (id: string) => jget(`/api/proxy/gaps/runs/${id}`),
  createGapRun: (data: unknown) => jsend('POST', '/api/proxy/gaps/runs', data),
  getGapResults: (id: string, params?: Record<string, string | undefined>) =>
    jget(`/api/proxy/gaps/runs/${id}/results${qs(params)}`),
  getGapDrilldown: (id: string, params?: Record<string, string | undefined>) =>
    jget(`/api/proxy/gaps/runs/${id}/drilldown${qs(params)}`),
  deleteGapRun: (id: string) => jsend('DELETE', `/api/proxy/gaps/runs/${id}`),

  // Scenarios
  getScenarios: () => jget('/api/proxy/scenarios'),
  getScenario: (id: string) => jget(`/api/proxy/scenarios/${id}`),
  createScenario: (data: unknown) => jsend('POST', '/api/proxy/scenarios', data),
  compareScenarios: (params?: Record<string, string | undefined>) =>
    jget(`/api/proxy/scenarios/compare${qs(params)}`),
  getScenarioSensitivity: (id: string) => jget(`/api/proxy/scenarios/${id}/sensitivity`),
  deleteScenario: (id: string) => jsend('DELETE', `/api/proxy/scenarios/${id}`),

  // Offers
  getOffers: () => jget('/api/proxy/offers'),
  getOffer: (id: string) => jget(`/api/proxy/offers/${id}`),
  evaluateOffer: (data: unknown) => jsend('POST', '/api/proxy/offers/evaluate', data),
  createOffer: (data: unknown) => jsend('POST', '/api/proxy/offers', data),
  decideOffer: (id: string, data: unknown) => jsend('PUT', `/api/proxy/offers/${id}/decision`, data),
  deleteOffer: (id: string) => jsend('DELETE', `/api/proxy/offers/${id}`),

  // Merit
  getMeritCycles: () => jget('/api/proxy/merit'),
  getMeritCycle: (id: string) => jget(`/api/proxy/merit/${id}`),
  createMeritCycle: (data: unknown) => jsend('POST', '/api/proxy/merit', data),
  overrideMeritAllocation: (id: string, allocId: string, data: unknown) =>
    jsend('PUT', `/api/proxy/merit/${id}/allocations/${allocId}`, data),
  lockMeritCycle: (id: string) => jsend('POST', `/api/proxy/merit/${id}/lock`, {}),
  compareMeritModels: (id: string) => jget(`/api/proxy/merit/${id}/compare`),
  deleteMeritCycle: (id: string) => jsend('DELETE', `/api/proxy/merit/${id}`),

  // Evidence
  getEvidencePacks: () => jget('/api/proxy/evidence'),
  getEvidencePack: (id: string) => jget(`/api/proxy/evidence/${id}`),
  createEvidencePack: (data: unknown) => jsend('POST', '/api/proxy/evidence', data),
  publishEvidencePack: (id: string) => jsend('POST', `/api/proxy/evidence/${id}/publish`, {}),
  getSharedEvidencePack: (token: string) => jget(`/api/proxy/evidence/shared/${token}`),
  deleteEvidencePack: (id: string) => jsend('DELETE', `/api/proxy/evidence/${id}`),

  // Attestations
  getAttestations: (params?: Record<string, string | undefined>) =>
    jget(`/api/proxy/attestations${qs(params)}`),
  createAttestation: (data: unknown) => jsend('POST', '/api/proxy/attestations', data),
  deleteAttestation: (id: string) => jsend('DELETE', `/api/proxy/attestations/${id}`),

  // Guardrails
  getGuardrails: () => jget('/api/proxy/guardrails'),
  createGuardrail: (data: unknown) => jsend('POST', '/api/proxy/guardrails', data),
  updateGuardrail: (id: string, data: unknown) => jsend('PUT', `/api/proxy/guardrails/${id}`, data),
  deleteGuardrail: (id: string) => jsend('DELETE', `/api/proxy/guardrails/${id}`),

  // Saved filters
  getSavedFilters: (params?: Record<string, string | undefined>) =>
    jget(`/api/proxy/filters${qs(params)}`),
  createSavedFilter: (data: unknown) => jsend('POST', '/api/proxy/filters', data),
  deleteSavedFilter: (id: string) => jsend('DELETE', `/api/proxy/filters/${id}`),

  // Tags
  getTags: () => jget('/api/proxy/tags'),
  createTag: (data: unknown) => jsend('POST', '/api/proxy/tags', data),
  deleteTag: (id: string) => jsend('DELETE', `/api/proxy/tags/${id}`),

  // Notifications
  getNotifications: () => jget('/api/proxy/notifications'),
  markNotificationRead: (id: string) => jsend('POST', `/api/proxy/notifications/${id}/read`, {}),
  markAllNotificationsRead: () => jsend('POST', '/api/proxy/notifications/read-all', {}),

  // Webhooks
  getWebhooks: () => jget('/api/proxy/webhooks'),
  createWebhook: (data: unknown) => jsend('POST', '/api/proxy/webhooks', data),
  updateWebhook: (id: string, data: unknown) => jsend('PUT', `/api/proxy/webhooks/${id}`, data),
  deleteWebhook: (id: string) => jsend('DELETE', `/api/proxy/webhooks/${id}`),
  getWebhookDeliveries: (id: string) => jget(`/api/proxy/webhooks/${id}/deliveries`),

  // API keys
  getApiKeys: () => jget('/api/proxy/apikeys'),
  createApiKey: (data: unknown) => jsend('POST', '/api/proxy/apikeys', data),
  revokeApiKey: (id: string) => jsend('POST', `/api/proxy/apikeys/${id}/revoke`, {}),
  deleteApiKey: (id: string) => jsend('DELETE', `/api/proxy/apikeys/${id}`),

  // Audit log
  getAuditLog: (params?: Record<string, string | number | undefined>) =>
    jget(`/api/proxy/auditlog${qs(params)}`),

  // Settings
  getSettings: () => jget('/api/proxy/settings'),
  updateSettings: (data: unknown) => jsend('PUT', '/api/proxy/settings', data),

  // Dashboard
  getDashboardSummary: () => jget('/api/proxy/dashboard/summary'),
  getDashboardOutliers: () => jget('/api/proxy/dashboard/outliers'),
  getDashboardAnalytics: () => jget('/api/proxy/dashboard/analytics'),

  // Sample
  seedSample: () => jsend('POST', '/api/proxy/sample/seed', {}),
  getSampleStatus: () => jget('/api/proxy/sample/status'),

  // Billing
  getBillingPlan: () => jget('/api/proxy/billing/plan'),
  startCheckout: () => jsend('POST', '/api/proxy/billing/checkout', {}),
  openBillingPortal: () => jsend('POST', '/api/proxy/billing/portal', {}),
}

export default api
