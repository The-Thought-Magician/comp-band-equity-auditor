'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Workspace {
  id: string
  name: string
  owner_id: string
  base_currency: string
  created_at?: string
  updated_at?: string
}

interface Settings {
  id: string
  workspace_id: string
  base_currency: string
  default_reference_group: string
  gap_threshold_pct: number
  pii_masking: boolean
  created_at?: string
  updated_at?: string
}

interface FxRate {
  id: string
  workspace_id: string
  from_currency: string
  to_currency: string
  rate: number
  created_at?: string
}

interface Tag {
  id: string
  workspace_id: string
  name: string
  color: string
  created_at?: string
}

interface BillingPlan {
  subscription: {
    id?: string
    plan_id?: string
    status?: string
    current_period_end?: string | null
  } | null
  plan: {
    id: string
    name: string
    price_cents: number
  } | null
  stripeEnabled: boolean
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR', 'JPY', 'SGD', 'CHF', 'SEK', 'BRL', 'MXN']
const REFERENCE_GROUPS = [
  { value: 'male', label: 'Men (reference)' },
  { value: 'majority', label: 'Majority ethnicity (reference)' },
  { value: 'overall', label: 'Overall mean' },
]
const TAG_COLORS = [
  { value: 'violet', hex: '#8b5cf6' },
  { value: 'green', hex: '#10b981' },
  { value: 'amber', hex: '#f59e0b' },
  { value: 'rose', hex: '#f43f5e' },
  { value: 'sky', hex: '#0ea5e9' },
  { value: 'slate', hex: '#64748b' },
]

function colorHex(color: string): string {
  return TAG_COLORS.find((c) => c.value === color)?.hex ?? color ?? '#64748b'
}

function fmtMoney(cents: number): string {
  return ((cents ?? 0) / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [fxRates, setFxRates] = useState<FxRate[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [billing, setBilling] = useState<BillingPlan | null>(null)

  // Workspace form
  const [wsName, setWsName] = useState('')
  const [wsCurrency, setWsCurrency] = useState('USD')
  const [savingWs, setSavingWs] = useState(false)
  const [wsMsg, setWsMsg] = useState<string | null>(null)

  // Comp settings form
  const [refGroup, setRefGroup] = useState('male')
  const [gapThreshold, setGapThreshold] = useState('5')
  const [piiMasking, setPiiMasking] = useState(false)
  const [settingsCurrency, setSettingsCurrency] = useState('USD')
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null)

  // FX modal
  const [fxOpen, setFxOpen] = useState(false)
  const [fxForm, setFxForm] = useState({ from_currency: 'EUR', to_currency: 'USD', rate: '' })
  const [fxError, setFxError] = useState<string | null>(null)
  const [savingFx, setSavingFx] = useState(false)
  const [deletingFx, setDeletingFx] = useState<string | null>(null)

  // Tag modal
  const [tagOpen, setTagOpen] = useState(false)
  const [tagForm, setTagForm] = useState({ name: '', color: 'violet' })
  const [tagError, setTagError] = useState<string | null>(null)
  const [savingTag, setSavingTag] = useState(false)
  const [deletingTag, setDeletingTag] = useState<string | null>(null)

  // Billing
  const [billingBusy, setBillingBusy] = useState(false)
  const [billingMsg, setBillingMsg] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [ws, st, fx, tg, bl] = await Promise.all([
        api.getWorkspace(),
        api.getSettings(),
        api.getFxRates().catch(() => []),
        api.getTags().catch(() => []),
        api.getBillingPlan().catch(() => null),
      ])
      setWorkspace(ws ?? null)
      setSettings(st ?? null)
      setFxRates(Array.isArray(fx) ? fx : [])
      setTags(Array.isArray(tg) ? tg : [])
      setBilling(bl ?? null)

      if (ws) {
        setWsName(ws.name ?? '')
        setWsCurrency(ws.base_currency ?? 'USD')
      }
      if (st) {
        setRefGroup(st.default_reference_group ?? 'male')
        setGapThreshold(String(st.gap_threshold_pct ?? 5))
        setPiiMasking(Boolean(st.pii_masking))
        setSettingsCurrency(st.base_currency ?? ws?.base_currency ?? 'USD')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function saveWorkspace() {
    setWsMsg(null)
    if (!wsName.trim()) {
      setWsMsg('Workspace name is required')
      return
    }
    setSavingWs(true)
    try {
      const updated = await api.updateWorkspace({ name: wsName.trim(), base_currency: wsCurrency })
      setWorkspace(updated ?? null)
      setWsMsg('Saved')
      setTimeout(() => setWsMsg(null), 2500)
    } catch (e) {
      setWsMsg(e instanceof Error ? e.message : 'Failed to save workspace')
    } finally {
      setSavingWs(false)
    }
  }

  async function saveSettings() {
    setSettingsMsg(null)
    const thr = Number(gapThreshold)
    if (!Number.isFinite(thr) || thr < 0) {
      setSettingsMsg('Gap threshold must be a non-negative number')
      return
    }
    setSavingSettings(true)
    try {
      const updated = await api.updateSettings({
        base_currency: settingsCurrency,
        default_reference_group: refGroup,
        gap_threshold_pct: thr,
        pii_masking: piiMasking,
      })
      setSettings(updated ?? null)
      setSettingsMsg('Saved')
      setTimeout(() => setSettingsMsg(null), 2500)
    } catch (e) {
      setSettingsMsg(e instanceof Error ? e.message : 'Failed to save settings')
    } finally {
      setSavingSettings(false)
    }
  }

  function openFx() {
    setFxForm({ from_currency: 'EUR', to_currency: workspace?.base_currency ?? 'USD', rate: '' })
    setFxError(null)
    setFxOpen(true)
  }

  async function submitFx() {
    setFxError(null)
    const rateNum = Number(fxForm.rate)
    if (fxForm.from_currency === fxForm.to_currency) {
      setFxError('From and to currencies must differ')
      return
    }
    if (!Number.isFinite(rateNum) || rateNum <= 0) {
      setFxError('Enter a valid positive rate')
      return
    }
    setSavingFx(true)
    try {
      await api.upsertFxRate({
        from_currency: fxForm.from_currency,
        to_currency: fxForm.to_currency,
        rate: rateNum,
      })
      setFxOpen(false)
      const fx = await api.getFxRates().catch(() => [])
      setFxRates(Array.isArray(fx) ? fx : [])
    } catch (e) {
      setFxError(e instanceof Error ? e.message : 'Failed to save FX rate')
    } finally {
      setSavingFx(false)
    }
  }

  async function deleteFx(id: string) {
    if (!confirm('Delete this FX rate?')) return
    setDeletingFx(id)
    try {
      await api.deleteFxRate(id)
      setFxRates((prev) => prev.filter((r) => r.id !== id))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete FX rate')
    } finally {
      setDeletingFx(null)
    }
  }

  function openTag() {
    setTagForm({ name: '', color: 'violet' })
    setTagError(null)
    setTagOpen(true)
  }

  async function submitTag() {
    setTagError(null)
    if (!tagForm.name.trim()) {
      setTagError('Tag name is required')
      return
    }
    if (tags.some((t) => t.name.toLowerCase() === tagForm.name.trim().toLowerCase())) {
      setTagError('A tag with that name already exists')
      return
    }
    setSavingTag(true)
    try {
      const created = await api.createTag({ name: tagForm.name.trim(), color: tagForm.color })
      setTags((prev) => [...prev, created].filter(Boolean) as Tag[])
      setTagOpen(false)
    } catch (e) {
      setTagError(e instanceof Error ? e.message : 'Failed to create tag')
    } finally {
      setSavingTag(false)
    }
  }

  async function deleteTag(id: string) {
    if (!confirm('Delete this tag?')) return
    setDeletingTag(id)
    try {
      await api.deleteTag(id)
      setTags((prev) => prev.filter((t) => t.id !== id))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete tag')
    } finally {
      setDeletingTag(null)
    }
  }

  async function handleCheckout() {
    setBillingMsg(null)
    setBillingBusy(true)
    try {
      const res = await api.startCheckout()
      if (res?.url) {
        window.location.href = res.url
      } else {
        setBillingMsg('Checkout is unavailable (Stripe not configured).')
      }
    } catch (e) {
      setBillingMsg(e instanceof Error ? e.message : 'Checkout unavailable. Stripe is not configured.')
    } finally {
      setBillingBusy(false)
    }
  }

  async function handlePortal() {
    setBillingMsg(null)
    setBillingBusy(true)
    try {
      const res = await api.openBillingPortal()
      if (res?.url) {
        window.location.href = res.url
      } else {
        setBillingMsg('Billing portal is unavailable (Stripe not configured).')
      }
    } catch (e) {
      setBillingMsg(e instanceof Error ? e.message : 'Portal unavailable. Stripe is not configured.')
    } finally {
      setBillingBusy(false)
    }
  }

  const planName = useMemo(() => {
    const pid = billing?.subscription?.plan_id ?? billing?.plan?.id ?? 'free'
    return pid === 'pro' ? 'Pro' : 'Free'
  }, [billing])

  const isPro = planName === 'Pro' && (billing?.subscription?.status === 'active' || billing?.subscription?.status === 'trialing')

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner label="Loading settings..." />
      </div>
    )
  }

  if (error) {
    return (
      <Card>
        <CardBody>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-rose-300">{error}</p>
            <Button variant="secondary" onClick={load}>
              Retry
            </Button>
          </div>
        </CardBody>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-100">Settings</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Manage your workspace, comp analysis defaults, currency conversion, tags, and billing.
        </p>
      </div>

      {/* Workspace + Comp settings */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-neutral-100">Workspace</h2>
            {workspace?.id && (
              <span className="font-mono text-xs text-neutral-500">{workspace.id.slice(0, 8)}</span>
            )}
          </CardHeader>
          <CardBody className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
                Workspace name
              </label>
              <input
                value={wsName}
                onChange={(e) => setWsName(e.target.value)}
                placeholder="Acme People Analytics"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
                Base currency
              </label>
              <select
                value={wsCurrency}
                onChange={(e) => setWsCurrency(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-neutral-500">
                All salaries are normalized to this currency for analysis.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={saveWorkspace} disabled={savingWs}>
                {savingWs ? 'Saving...' : 'Save workspace'}
              </Button>
              {wsMsg && (
                <span
                  className={`text-sm ${wsMsg === 'Saved' ? 'text-emerald-300' : 'text-rose-300'}`}
                >
                  {wsMsg}
                </span>
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-neutral-100">Comp analysis defaults</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
                Analysis currency
              </label>
              <select
                value={settingsCurrency}
                onChange={(e) => setSettingsCurrency(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
                Default reference group
              </label>
              <select
                value={refGroup}
                onChange={(e) => setRefGroup(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
              >
                {REFERENCE_GROUPS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-neutral-500">
                The baseline cohort that gap analyses compare other groups against.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
                Gap alert threshold (%)
              </label>
              <input
                type="number"
                min={0}
                step={0.5}
                value={gapThreshold}
                onChange={(e) => setGapThreshold(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-orange-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-neutral-500">
                Unexplained gaps above this percentage are flagged as material.
              </p>
            </div>
            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5">
              <div>
                <div className="text-sm font-medium text-neutral-200">PII masking</div>
                <div className="text-xs text-neutral-500">Hide employee names &amp; refs in shared views.</div>
              </div>
              <input
                type="checkbox"
                checked={piiMasking}
                onChange={(e) => setPiiMasking(e.target.checked)}
                className="h-4 w-4 accent-orange-500"
              />
            </label>
            <div className="flex items-center gap-3">
              <Button onClick={saveSettings} disabled={savingSettings}>
                {savingSettings ? 'Saving...' : 'Save defaults'}
              </Button>
              {settingsMsg && (
                <span
                  className={`text-sm ${settingsMsg === 'Saved' ? 'text-emerald-300' : 'text-rose-300'}`}
                >
                  {settingsMsg}
                </span>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      {/* FX rates */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-neutral-100">FX rates</h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              Conversion rates used to normalize multi-currency salaries.
            </p>
          </div>
          <Button variant="secondary" onClick={openFx}>
            + Add rate
          </Button>
        </CardHeader>
        <CardBody>
          {fxRates.length === 0 ? (
            <EmptyState
              title="No FX rates configured"
              description="Add conversion rates so foreign-currency salaries normalize correctly."
              icon="💱"
              action={<Button onClick={openFx}>Add your first rate</Button>}
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>From</TH>
                  <TH>To</TH>
                  <TH className="text-right">Rate</TH>
                  <TH>Added</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {fxRates.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-mono text-neutral-200">{r.from_currency}</TD>
                    <TD className="font-mono text-neutral-200">{r.to_currency}</TD>
                    <TD className="text-right font-mono text-neutral-200">{r.rate}</TD>
                    <TD className="text-neutral-400">
                      {r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}
                    </TD>
                    <TD className="text-right">
                      <Button
                        variant="danger"
                        className="px-3 py-1.5 text-xs"
                        disabled={deletingFx === r.id}
                        onClick={() => deleteFx(r.id)}
                      >
                        {deletingFx === r.id ? '...' : 'Delete'}
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Tags */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-neutral-100">Tags</h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              Labels you can apply to employees for cohorting and bulk actions.
            </p>
          </div>
          <Button variant="secondary" onClick={openTag}>
            + New tag
          </Button>
        </CardHeader>
        <CardBody>
          {tags.length === 0 ? (
            <EmptyState
              title="No tags yet"
              description="Create tags to segment employees and drive cohort definitions."
              icon="🏷️"
              action={<Button onClick={openTag}>Create your first tag</Button>}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-900 py-1 pl-2.5 pr-1.5 text-sm text-neutral-200"
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: colorHex(t.color) }}
                    aria-hidden
                  />
                  {t.name}
                  <button
                    onClick={() => deleteTag(t.id)}
                    disabled={deletingTag === t.id}
                    className="rounded-full p-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-rose-300 disabled:opacity-50"
                    aria-label={`Delete tag ${t.name}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Billing */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-neutral-100">Billing &amp; plan</h2>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-neutral-400">Current plan</div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-xl font-semibold text-neutral-100">{planName}</span>
                  <Badge tone={isPro ? 'green' : 'neutral'}>
                    {billing?.subscription?.status ?? (isPro ? 'active' : 'free')}
                  </Badge>
                </div>
                {billing?.plan && (
                  <div className="mt-1 text-xs text-neutral-500">
                    {billing.plan.price_cents > 0
                      ? `${fmtMoney(billing.plan.price_cents)} / month`
                      : 'No charge'}
                  </div>
                )}
                {billing?.subscription?.current_period_end && (
                  <div className="mt-0.5 text-xs text-neutral-500">
                    Renews {new Date(billing.subscription.current_period_end).toLocaleDateString()}
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-col items-start gap-2 sm:items-end">
              {!billing?.stripeEnabled && (
                <Badge tone="amber">Stripe not configured</Badge>
              )}
              <div className="flex gap-2">
                {isPro ? (
                  <Button
                    variant="secondary"
                    onClick={handlePortal}
                    disabled={billingBusy || !billing?.stripeEnabled}
                  >
                    {billingBusy ? 'Opening...' : 'Manage billing'}
                  </Button>
                ) : (
                  <Button
                    onClick={handleCheckout}
                    disabled={billingBusy || !billing?.stripeEnabled}
                  >
                    {billingBusy ? 'Starting...' : 'Upgrade to Pro'}
                  </Button>
                )}
              </div>
            </div>
          </div>
          {billingMsg && <p className="text-sm text-amber-300">{billingMsg}</p>}
          {!billing?.stripeEnabled && (
            <p className="text-xs text-neutral-500">
              Billing actions are disabled in this environment because Stripe credentials are not set.
              Upgrade and portal flows activate automatically once configured.
            </p>
          )}
        </CardBody>
      </Card>

      {/* FX modal */}
      <Modal
        open={fxOpen}
        onClose={() => !savingFx && setFxOpen(false)}
        title="Add FX rate"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFxOpen(false)} disabled={savingFx}>
              Cancel
            </Button>
            <Button onClick={submitFx} disabled={savingFx}>
              {savingFx ? 'Saving...' : 'Save rate'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
                From
              </label>
              <select
                value={fxForm.from_currency}
                onChange={(e) => setFxForm({ ...fxForm, from_currency: e.target.value })}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
                To
              </label>
              <select
                value={fxForm.to_currency}
                onChange={(e) => setFxForm({ ...fxForm, to_currency: e.target.value })}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
              Rate (1 {fxForm.from_currency} = ? {fxForm.to_currency})
            </label>
            <input
              type="number"
              min={0}
              step="0.0001"
              value={fxForm.rate}
              onChange={(e) => setFxForm({ ...fxForm, rate: e.target.value })}
              placeholder="1.0850"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-orange-500 focus:outline-none"
            />
          </div>
          {fxError && <p className="text-sm text-rose-300">{fxError}</p>}
        </div>
      </Modal>

      {/* Tag modal */}
      <Modal
        open={tagOpen}
        onClose={() => !savingTag && setTagOpen(false)}
        title="New tag"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTagOpen(false)} disabled={savingTag}>
              Cancel
            </Button>
            <Button onClick={submitTag} disabled={savingTag}>
              {savingTag ? 'Saving...' : 'Create tag'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
              Tag name
            </label>
            <input
              value={tagForm.name}
              onChange={(e) => setTagForm({ ...tagForm, name: e.target.value })}
              placeholder="Flight risk"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-orange-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-neutral-400">
              Color
            </label>
            <div className="flex flex-wrap gap-2">
              {TAG_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setTagForm({ ...tagForm, color: c.value })}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${
                    tagForm.color === c.value
                      ? 'border-orange-500 bg-orange-500/10 text-neutral-100'
                      : 'border-neutral-700 bg-neutral-950 text-neutral-400 hover:border-neutral-600'
                  }`}
                >
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: c.hex }}
                    aria-hidden
                  />
                  {c.value}
                </button>
              ))}
            </div>
          </div>
          {tagError && <p className="text-sm text-rose-300">{tagError}</p>}
        </div>
      </Modal>
    </div>
  )
}
