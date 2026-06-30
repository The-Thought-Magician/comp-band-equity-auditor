'use client'
import { useEffect } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
}

export function Modal({ open, onClose, title, children, footer, className = '' }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative z-10 w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl ${className}`}
      >
        {title != null && (
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-100">{title}</h2>
            <button
              onClick={onClose}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        )}
        <div className="px-5 py-4">{children}</div>
        {footer != null && (
          <div className="flex justify-end gap-2 border-t border-slate-800 px-5 py-4">{footer}</div>
        )}
      </div>
    </div>
  )
}

export default Modal
