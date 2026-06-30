import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'CompBandEquityAuditor',
  description: 'Pay-equity governance: versioned comp bands, deterministic gap analysis, and board-ready remediation costing.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased">{children}</body>
    </html>
  )
}
