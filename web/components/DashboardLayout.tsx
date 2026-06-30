'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'
import { FullPageSpinner } from '@/components/ui/Spinner'

type NavItem = { label: string; href: string }
type NavSection = { title: string; items: NavItem[] }

const SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard' },
      { label: 'Analytics', href: '/dashboard/analytics' },
    ],
  },
  {
    title: 'Data',
    items: [
      { label: 'Datasets', href: '/dashboard/datasets' },
      { label: 'Comp Bands', href: '/dashboard/bands' },
    ],
  },
  {
    title: 'Audit',
    items: [
      { label: 'Positioning', href: '/dashboard/positioning' },
      { label: 'Pay Gaps', href: '/dashboard/gaps' },
      { label: 'Cohorts', href: '/dashboard/cohorts' },
    ],
  },
  {
    title: 'Remediation',
    items: [
      { label: 'Scenarios', href: '/dashboard/scenarios' },
      { label: 'Offer Guardrails', href: '/dashboard/offers' },
      { label: 'Merit Cycles', href: '/dashboard/merit' },
    ],
  },
  {
    title: 'Reporting',
    items: [
      { label: 'Evidence Packs', href: '/dashboard/evidence' },
      { label: 'Audit Log', href: '/dashboard/audit-log' },
    ],
  },
  {
    title: 'Workspace',
    items: [
      { label: 'Webhooks', href: '/dashboard/webhooks' },
      { label: 'API Keys', href: '/dashboard/api-keys' },
      { label: 'Notifications', href: '/dashboard/notifications' },
      { label: 'Settings', href: '/dashboard/settings' },
      { label: 'Onboarding', href: '/dashboard/onboarding' },
    ],
  },
]

function isActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(href + '/')
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [ready, setReady] = useState(false)
  const [workspaceName, setWorkspaceName] = useState('Workspace')
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const s = await authClient.getSession()
      if (cancelled) return
      if (!s?.data?.user) {
        router.push('/auth/sign-in')
        return
      }
      const u = s.data.user as { name?: string; email?: string }
      setWorkspaceName(u.name || u.email || 'Workspace')
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  const signOut = async () => {
    await authClient.signOut()
    router.push('/')
  }

  if (!ready) return <FullPageSpinner />

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 transform border-r border-slate-800 bg-slate-900/80 backdrop-blur transition-transform lg:static lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center gap-2 border-b border-slate-800 px-5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600 text-sm font-black text-white">
            C
          </span>
          <span className="text-sm font-bold tracking-tight text-white">CompBandEquityAuditor</span>
        </div>
        <nav className="h-[calc(100vh-4rem)] overflow-y-auto px-3 py-4">
          {SECTIONS.map((section) => (
            <div key={section.title} className="mb-5">
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                {section.title}
              </div>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const active = isActive(pathname, item.href)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                        active
                          ? 'bg-violet-600/15 font-medium text-violet-200'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-950/60 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-800 bg-slate-950/80 px-4 backdrop-blur lg:px-6">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Toggle navigation"
            >
              ☰
            </button>
            <span className="truncate text-sm font-medium text-slate-300">{workspaceName}</span>
          </div>
          <button
            onClick={signOut}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
          >
            Sign out
          </button>
        </header>
        <main className="flex-1 p-4 lg:p-8">{children}</main>
      </div>
    </div>
  )
}
