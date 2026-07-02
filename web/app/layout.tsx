import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })

export const metadata: Metadata = {
  title: 'CompBandEquityAuditor',
  description: 'Pay-equity governance: versioned comp bands, deterministic gap analysis, and board-ready remediation costing.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-neutral-950 text-neutral-100 min-h-screen antialiased font-sans">{children}</body>
    </html>
  )
}
