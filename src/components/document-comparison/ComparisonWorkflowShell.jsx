import React from 'react';
import { Progress } from '@/components/ui/progress';

/**
 * ComparisonWorkflowShell
 *
 * The canonical shared page structure used by BOTH the proposer
 * (DocumentComparisonCreate) and recipient (SharedReport) comparison workflows.
 *
 * Provides the inner container, optional back navigation, page title, step
 * progress bar, and an optional extraHeader slot (for metadata cards, alerts
 * etc. that sit between the progress bar and the step content).
 *
 * The outer page background (min-h-screen, bg-*, py-*) is intentionally
 * left to the parent page, since proposer and recipient wrap differently.
 *
 * Props
 *   backSlot            ReactNode   – back link / button above the title
 *   title               string
 *   subtitle            string
 *   step                number      – current step (shown as "Step N of M")
 *   totalSteps          number      – default 3
 *   progress            number      – 0–100, drives the progress bar
 *   saveStatusLabel     string      – e.g. "Saved" · "Saving…" · "Unsaved changes"
 *   saveStatusClassName string      – tailwind classes for saveStatusLabel
 *   extraHeader         ReactNode   – rendered between progress bar and children
 *                                     (metadata card, auth alerts, etc.)
 *   children            ReactNode   – step content
 */
export default function ComparisonWorkflowShell({
  backSlot,
  title,
  subtitle,
  step,
  totalSteps = 3,
  progress = 0,
  saveStatusLabel,
  saveStatusClassName = 'text-slate-400',
  extraHeader,
  children,
}) {
  return (
    <div className="max-w-[1400px] mx-auto px-6 md:px-10 xl:px-12">
      {/* ── Back nav + page title ─────────────────────────────── */}
      <div className="mb-5">
        {backSlot && <div className="mb-2">{backSlot}</div>}
        {title && <h1 className="text-2xl font-bold text-slate-900">{title}</h1>}
        {subtitle && <p className="text-slate-500 mt-1">{subtitle}</p>}
      </div>

      {/* ── Step indicator + progress bar ────────────────────── */}
      <div className="mb-5">
        <div className="flex items-center justify-between text-sm mb-3">
          <div className="flex items-center gap-3">
            <span
              className="font-semibold text-blue-600"
              data-testid="doc-comparison-step-indicator"
            >
              Step {step} of {totalSteps}
            </span>
            {saveStatusLabel && (
              <span
                className={`text-xs ${saveStatusClassName}`}
                data-testid="doc-comparison-save-status"
              >
                {saveStatusLabel}
              </span>
            )}
          </div>
          <span className="text-slate-500">{Math.round(progress)}% complete</span>
        </div>
        <Progress value={progress} className="h-3" />
      </div>

      {/* ── Extra header (metadata cards, alerts, …) ─────────── */}
      {extraHeader && <div className="space-y-4 mb-5">{extraHeader}</div>}

      {/* ── Step content ─────────────────────────────────────── */}
      {children}
    </div>
  );
}
