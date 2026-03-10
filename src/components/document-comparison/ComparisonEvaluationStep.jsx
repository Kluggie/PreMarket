import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';
import { ComparisonDetailTabs } from '@/components/document-comparison/ComparisonDetailTabs';

/**
 * ComparisonEvaluationStep
 *
 * The shared evaluation-results layout used for Step 3 in BOTH the proposer
 * (post-evaluation view in DocumentComparisonDetail) and the recipient
 * (SharedReport step 3) comparison workflows.
 *
 * Architecture note
 *   This component owns the card / tab / back-button structure.
 *   Caller supplies:
 *     – actionSlot:  buttons (Run / Re-run / Send to proposer / Edit again …)
 *     – aiReportProps / proposalDetailsProps: forwarded directly to ComparisonDetailTabs
 *
 * Props
 *   stepTitle           string       – Card heading, default "Step 3: Evaluation"
 *   stepDescription     string       – Card sub-heading
 *   actionSlot          ReactNode    – action buttons rendered in the card
 *   activeTab           string       – forwarded to ComparisonDetailTabs
 *   onTabChange         fn           – forwarded to ComparisonDetailTabs
 *   hasReportBadge      boolean
 *   tabOrder            string[]
 *   detailsTabLabel     string
 *   aiReportProps       object       – forwarded to ComparisonAiReportTab
 *   proposalDetailsProps object      – forwarded to ComparisonProposalDetailsTab
 *   onBack              fn           – Back button handler (omit to hide the button)
 *   backLabel           string       – default "Back to Editor"
 */
export default function ComparisonEvaluationStep({
  stepTitle = 'Step 3: Evaluation',
  stepDescription = 'Run and review the latest evaluation.',
  actionSlot,
  activeTab,
  onTabChange,
  hasReportBadge = false,
  tabOrder = ['details', 'report'],
  detailsTabLabel = 'Proposal',
  aiReportProps = {},
  proposalDetailsProps = {},
  onBack,
  backLabel = 'Back to Editor',
}) {
  return (
    <div className="space-y-6" data-testid="doc-comparison-step-3">
      {/* ── Actions card ──────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>{stepTitle}</CardTitle>
          {stepDescription && (
            <CardDescription>{stepDescription}</CardDescription>
          )}
        </CardHeader>
        {actionSlot && (
          <CardContent>
            <div className="flex flex-wrap gap-2">{actionSlot}</div>
          </CardContent>
        )}
      </Card>

      {/* ── AI report + proposal detail tabs ─────────────────── */}
      <ComparisonDetailTabs
        activeTab={activeTab}
        onTabChange={onTabChange}
        hasReportBadge={hasReportBadge}
        tabOrder={tabOrder}
        detailsTabLabel={detailsTabLabel}
        aiReportProps={aiReportProps}
        proposalDetailsProps={proposalDetailsProps}
      />

      {/* ── Navigation footer ─────────────────────────────────── */}
      {onBack && (
        <div className="flex items-center pt-2">
          <Button variant="outline" onClick={onBack} data-testid="step3-back-button">
            <ArrowLeft className="w-4 h-4 mr-2" />
            {backLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
