import React, { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import CoachResponseText from '@/components/document-comparison/CoachResponseText';
import { DOCUMENT_COMPARISON_COACH_ACTIONS } from '@/components/document-comparison/coachActions';
import {
  getNormalizedSuggestionId,
  getSuggestionCategoryLabel,
} from '@/pages/document-comparison/coachSuggestionUtils';
import { MAX_THREADS } from '@/pages/document-comparison/suggestionThreads';
import {
  AlertTriangle,
  Check,
  Copy,
  Loader2,
  MessagesSquare,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';

export default function SuggestionCoachPanel({
  activeThread = null,
  activeThreadEntryCount = 0,
  atThreadLimit = false,
  canStartNewThread = true,
  coachCached = false,
  coachError = '',
  coachLoading = false,
  coachNotConfigured = false,
  coachResponseLabel = 'Suggestion feedback',
  coachResponseMeta = '',
  coachResponseText = '',
  companyBriefSources = [],
  companyContextName = '',
  companyContextNameInputRef = null,
  companyContextSaveError = '',
  companyContextStatusClassName = 'text-slate-500',
  companyContextStatusText = '',
  companyContextValidationError = '',
  companyContextWebsite = '',
  customPromptText = '',
  deletingThreadId = null,
  disableCompanyBrief = false,
  disableCustomPrompt = false,
  disableSuggestedPrompts = false,
  expandedSuggestionIds = [],
  isApplyingReviewSuggestion = false,
  isCoachResponseCopied = false,
  isCustomPromptResponse = false,
  isSavingCompanyContext = false,
  leftDocLabel = 'Confidential Information',
  onCancelDelete = () => {},
  onCancelRename = () => {},
  onClearCoachResponse = () => {},
  onClosePendingReviewSuggestion = () => {},
  onCompanyContextBlur = () => {},
  onCompanyContextNameChange = () => {},
  onCompanyContextWebsiteChange = () => {},
  onConfirmCoachSuggestionApply = () => {},
  onConfirmDeleteThread = () => {},
  onConfirmRename = () => {},
  onCopyCoachResponse = () => {},
  onCopyPendingProposedText = () => {},
  onCustomPromptKeyDown = () => {},
  onCustomPromptTextChange = () => {},
  onDeleteThread = () => {},
  onDismissSuggestion = () => {},
  onOpenCoachSuggestionReview = () => {},
  onRetryCompanyContextSave = null,
  onRunCompanyBrief = () => {},
  onRunCustomPrompt = () => {},
  onRunSuggestedPrompt = () => {},
  onSelectThread = () => {},
  onStartNewThread = () => {},
  onStartRename = () => {},
  onToggleSuggestionExpanded = () => {},
  onToggleThreadHistory = () => {},
  onRenameInputValueChange = () => {},
  pendingReviewSuggestion = null,
  renamingThreadId = null,
  renameInputValue = '',
  rightDocLabel = 'Shared Information',
  showThreadHistory = false,
  suggestedPromptOptions = DOCUMENT_COMPARISON_COACH_ACTIONS,
  suggestionThreads = [],
  supplementaryAlert = null,
  visibleCoachSuggestions = [],
}) {
  const renameInputRef = useRef(null);

  useEffect(() => {
    if (!renamingThreadId) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      renameInputRef.current?.focus?.();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [renamingThreadId]);

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-600" />
            Ask for suggestions
            {coachCached ? <Badge variant="outline">Cached</Badge> : null}
          </CardTitle>
          <CardDescription>
            Generate suggestions only when you click an action. No background requests.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2" data-testid="suggestion-thread-bar">
            <div className="flex items-center gap-2 text-xs text-slate-600 min-w-0">
              <MessagesSquare className="w-3.5 h-3.5 shrink-0 text-slate-500" />
              {activeThread ? (
                <span className="truncate" title={activeThread.title}>
                  {activeThread.title}
                  {activeThreadEntryCount > 0 ? (
                    <span className="ml-1 text-slate-400">
                      ({Math.ceil(activeThreadEntryCount / 2)} {Math.ceil(activeThreadEntryCount / 2) === 1 ? 'exchange' : 'exchanges'})
                    </span>
                  ) : null}
                </span>
              ) : (
                <span className="text-slate-400">No active thread</span>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {suggestionThreads.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={onToggleThreadHistory}
                  data-testid="toggle-thread-history"
                >
                  {showThreadHistory ? 'Hide' : `${suggestionThreads.length}/${MAX_THREADS}`}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs px-2"
                disabled={coachLoading || !canStartNewThread}
                onClick={onStartNewThread}
                title={atThreadLimit ? 'Max 3 threads — delete one to start fresh' : undefined}
                data-testid="start-new-thread"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                New thread
              </Button>
            </div>
          </div>
          {atThreadLimit ? (
            <p className="text-[11px] text-slate-400 -mt-2 text-right" data-testid="thread-limit-notice">
              Max 3 threads. Delete one to start fresh.
            </p>
          ) : null}

          {showThreadHistory && suggestionThreads.length > 0 ? (
            <div className="rounded-md border border-slate-200 bg-white divide-y divide-slate-100" data-testid="thread-history-panel">
              {suggestionThreads.map((thread) => {
                const isActive = thread.id === activeThread?.id;
                const entryCount = thread.entries?.length || 0;
                const exchangeCount = Math.ceil(entryCount / 2);
                const isDeleting = deletingThreadId === thread.id;
                const isRenaming = renamingThreadId === thread.id;
                return (
                  <div
                    key={thread.id}
                    className={`group flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                      isActive ? 'bg-blue-50/60 border-l-2 border-blue-500' : 'hover:bg-slate-50'
                    }`}
                    data-testid={`thread-history-item-${thread.id}`}
                  >
                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        className="flex-1 min-w-0 text-xs border border-blue-400 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                        value={renameInputValue}
                        onChange={(event) => onRenameInputValueChange(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') onConfirmRename();
                          if (event.key === 'Escape') onCancelRename();
                        }}
                        data-testid={`thread-rename-input-${thread.id}`}
                      />
                    ) : (
                      <button
                        type="button"
                        className={`flex-1 min-w-0 text-left truncate font-medium ${isActive ? 'text-blue-700' : 'text-slate-700'}`}
                        onClick={() => onSelectThread(thread.id)}
                        title={thread.title}
                      >
                        {thread.title || 'Thread'}
                      </button>
                    )}

                    {isDeleting ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-red-600 font-medium">Delete?</span>
                        <button
                          type="button"
                          className="text-red-600 hover:text-red-700 font-semibold"
                          onClick={() => onConfirmDeleteThread(thread.id)}
                          data-testid={`thread-confirm-delete-${thread.id}`}
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          className="text-slate-400 hover:text-slate-600"
                          onClick={onCancelDelete}
                          data-testid={`thread-cancel-delete-${thread.id}`}
                        >
                          No
                        </button>
                      </div>
                    ) : isRenaming ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          className="text-blue-600 hover:text-blue-700 font-semibold"
                          onClick={onConfirmRename}
                          data-testid={`thread-confirm-rename-${thread.id}`}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="text-slate-400 hover:text-slate-600"
                          onClick={onCancelRename}
                          data-testid={`thread-cancel-rename-${thread.id}`}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-slate-400">
                          {exchangeCount > 0 ? `${exchangeCount} ex.` : 'empty'}
                        </span>
                        <button
                          type="button"
                          className="text-slate-300 hover:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => onStartRename(thread.id, thread.title)}
                          title="Rename"
                          data-testid={`thread-rename-btn-${thread.id}`}
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => onDeleteThread(thread.id)}
                          title="Delete thread"
                          data-testid={`thread-delete-btn-${thread.id}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="h-full rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Company
                    </p>
                    {companyContextStatusText ? (
                      <p
                        className={`text-xs ${companyContextStatusClassName}`}
                        data-testid="company-context-save-status"
                      >
                        {companyContextStatusText}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Input
                      ref={companyContextNameInputRef}
                      data-testid="company-context-name-input-inline"
                      placeholder="Company name"
                      value={companyContextName}
                      onChange={(event) => onCompanyContextNameChange(event.target.value)}
                      onBlur={onCompanyContextBlur}
                    />
                    <Input
                      data-testid="company-context-website-input-inline"
                      placeholder="Website"
                      value={companyContextWebsite}
                      onChange={(event) => onCompanyContextWebsiteChange(event.target.value)}
                      onBlur={onCompanyContextBlur}
                    />
                  </div>
                  {companyContextValidationError ? (
                    <p className="text-xs text-red-700" data-testid="company-context-validation-error">
                      {companyContextValidationError}
                    </p>
                  ) : null}
                  {companyContextSaveError ? (
                    <div className="flex items-center gap-2 text-xs text-red-700" data-testid="company-context-inline-error">
                      <span>{companyContextSaveError}</span>
                      {typeof onRetryCompanyContextSave === 'function' ? (
                        <button
                          type="button"
                          className="underline underline-offset-2"
                          onClick={onRetryCompanyContextSave}
                          disabled={isSavingCompanyContext}
                        >
                          Retry
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full mt-1"
                    disabled={coachLoading || coachNotConfigured || disableCompanyBrief}
                    onClick={onRunCompanyBrief}
                    data-testid="coach-company-brief-action"
                  >
                    {coachLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                    Generate Company Brief
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <p className="w-full text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Suggested Prompts</p>
                  {suggestedPromptOptions.map((option) => (
                    <Button
                      key={option.id}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={coachLoading || coachNotConfigured || disableSuggestedPrompts}
                      onClick={() => onRunSuggestedPrompt(option)}
                    >
                      {coachLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
            <div className="h-full rounded-lg border border-slate-200 bg-slate-50/60 p-4 shadow-sm" data-testid="coach-custom-prompt-panel">
              <div className="flex h-full flex-col gap-3">
                <div className="space-y-1">
                  <Label htmlFor="coach-custom-prompt-input" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Custom prompt
                  </Label>
                  <p className="text-xs text-slate-500">Ask for feedback, risks, gaps, strategy...</p>
                </div>
                <Textarea
                  id="coach-custom-prompt-input"
                  data-testid="coach-custom-prompt-input"
                  rows={5}
                  className="min-h-[140px] w-full resize-y bg-white"
                  placeholder="Ask for feedback, risks, gaps, strategy..."
                  value={customPromptText}
                  onChange={(event) => onCustomPromptTextChange(event.target.value)}
                  onKeyDown={onCustomPromptKeyDown}
                  disabled={coachLoading || coachNotConfigured || disableCustomPrompt}
                />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    data-testid="coach-custom-prompt-run"
                    onClick={onRunCustomPrompt}
                    disabled={
                      coachLoading ||
                      coachNotConfigured ||
                      disableCustomPrompt ||
                      !String(customPromptText || '').trim()
                    }
                  >
                    {coachLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    {coachLoading ? 'Running...' : 'Run'}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {coachNotConfigured ? (
            <Alert className="bg-amber-50 border-amber-200">
              <AlertTriangle className="h-4 w-4 text-amber-700" />
              <AlertDescription className="text-amber-800">
                AI suggestions are unavailable because Vertex AI is not configured.
              </AlertDescription>
            </Alert>
          ) : null}

          {!coachNotConfigured && coachError ? (
            <Alert className="bg-red-50 border-red-200">
              <AlertTriangle className="h-4 w-4 text-red-700" />
              <AlertDescription className="text-red-800">{coachError}</AlertDescription>
            </Alert>
          ) : null}

          {supplementaryAlert}

          {coachResponseText ? (
            <div
              className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition-all duration-200"
              data-testid={isCustomPromptResponse ? 'coach-custom-prompt-feedback' : 'coach-response-feedback'}
            >
              <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-3">
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{coachResponseLabel}</p>
                  {coachResponseMeta ? <p className="text-xs text-slate-500">{coachResponseMeta}</p> : null}
                </div>
                <div className="flex items-center gap-1">
                  <Button type="button" size="sm" variant="outline" onClick={onCopyCoachResponse} disabled={!coachResponseText}>
                    {isCoachResponseCopied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                    {isCoachResponseCopied ? 'Copied' : 'Copy'}
                  </Button>
                  <Button type="button" size="icon" variant="ghost" aria-label="Clear response" onClick={onClearCoachResponse}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="min-h-[132px] px-4 py-4">
                <CoachResponseText text={coachResponseText} />
                {companyBriefSources.length > 0 ? (
                  <div className="mt-4 border-t border-slate-200 pt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Sources</p>
                    <ul className="mt-2 space-y-1 text-xs text-slate-600" data-testid="company-brief-sources">
                      {companyBriefSources.map((source, index) => {
                        const sourceTitle = String(source?.title || '').trim() || `Source ${index + 1}`;
                        const url = String(source?.url || '').trim();
                        if (!url) {
                          return (
                            <li key={`company-brief-source-${index}`}>
                              [{index + 1}] {sourceTitle}
                            </li>
                          );
                        }
                        return (
                          <li key={`company-brief-source-${index}`}>
                            [{index + 1}]{' '}
                            <a href={url} target="_blank" rel="noreferrer" className="text-blue-700 underline-offset-2 hover:underline">
                              {sourceTitle}
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {visibleCoachSuggestions.length > 0 ? (
            <div className="space-y-2">
              {visibleCoachSuggestions.slice(0, 12).map((suggestion, index) => {
                const suggestionId = getNormalizedSuggestionId(suggestion, index);
                const expanded = expandedSuggestionIds.includes(suggestionId);
                const isShared = suggestion?.scope === 'shared' || suggestion?.proposed_change?.target === 'doc_b';
                const categoryLabel = getSuggestionCategoryLabel(suggestion?.category);
                return (
                  <div key={suggestionId || `coach-suggestion-${index}`} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{String(suggestion?.severity || 'info')}</Badge>
                        <Badge variant={isShared ? 'secondary' : 'outline'}>
                          {isShared ? 'Shared-safe' : 'Confidential-only'}
                        </Badge>
                        {categoryLabel ? <Badge variant="outline">{categoryLabel}</Badge> : null}
                        <span className="text-sm font-medium text-slate-800">{suggestion?.title || 'Suggestion'}</span>
                      </div>
                      <div className="flex gap-2">
                        <Button type="button" size="sm" onClick={() => onOpenCoachSuggestionReview(suggestion, suggestionId)}>
                          Review & Apply
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => onToggleSuggestionExpanded(suggestionId)}>
                          {expanded ? 'Hide' : 'Explain'}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => onDismissSuggestion(suggestionId)}>
                          Ignore
                        </Button>
                      </div>
                    </div>
                    {expanded ? (
                      <div className="mt-2 space-y-2 text-sm text-slate-600">
                        <p>{suggestion?.rationale || 'No rationale provided.'}</p>
                        <div className="rounded border border-slate-200 bg-slate-50 p-2 whitespace-pre-wrap">
                          {suggestion?.proposed_change?.text || ''}
                        </div>
                        {isShared && Array.isArray(suggestion?.evidence?.shared_quotes) && suggestion.evidence.shared_quotes.length ? (
                          <div>
                            <p className="text-xs font-semibold text-slate-500 mb-1">Shared evidence</p>
                            <ul className="list-disc pl-5 text-xs text-slate-600">
                              {suggestion.evidence.shared_quotes.map((quote) => (
                                <li key={`${suggestionId}-${quote.slice(0, 24)}`}>{quote}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(pendingReviewSuggestion)}
        onOpenChange={(open) => {
          if (!open) {
            onClosePendingReviewSuggestion();
          }
        }}
      >
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Suggested Change</DialogTitle>
            <DialogDescription>
              Confirm this suggestion before applying it to{' '}
              {pendingReviewSuggestion?.target === 'a' ? leftDocLabel : rightDocLabel}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {String(pendingReviewSuggestion?.suggestion?.severity || 'info')}
              </Badge>
              <Badge
                variant={pendingReviewSuggestion?.isShared ? 'secondary' : 'outline'}
              >
                {pendingReviewSuggestion?.isShared ? 'Shared-safe' : 'Confidential-only'}
              </Badge>
              {getSuggestionCategoryLabel(pendingReviewSuggestion?.suggestion?.category) ? (
                <Badge variant="outline">
                  {getSuggestionCategoryLabel(pendingReviewSuggestion?.suggestion?.category)}
                </Badge>
              ) : null}
              <span className="text-sm font-medium text-slate-800">
                {pendingReviewSuggestion?.suggestion?.title || 'Suggestion'}
              </span>
            </div>

            <p className="text-sm text-slate-600">
              {pendingReviewSuggestion?.suggestion?.rationale || 'No rationale provided.'}
            </p>

            <p className="text-xs text-slate-500">
              {pendingReviewSuggestion?.changeSummary || ''}
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-lg border border-slate-200 bg-white">
                <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">
                  Original
                </div>
                <div
                  className="px-3 py-3 text-sm text-slate-700 whitespace-pre-wrap min-h-[120px]"
                  dangerouslySetInnerHTML={{
                    __html: pendingReviewSuggestion?.diffPreview?.beforeHtml || '',
                  }}
                />
              </div>
              <div className="rounded-lg border border-slate-200 bg-white">
                <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">
                  Proposed
                </div>
                <div
                  className="px-3 py-3 text-sm text-slate-700 whitespace-pre-wrap min-h-[120px]"
                  dangerouslySetInnerHTML={{
                    __html: pendingReviewSuggestion?.diffPreview?.afterHtml || '',
                  }}
                />
              </div>
            </div>

            {pendingReviewSuggestion?.isShared &&
            Array.isArray(pendingReviewSuggestion?.suggestion?.evidence?.shared_quotes) &&
            pendingReviewSuggestion.suggestion.evidence.shared_quotes.length > 0 ? (
              <div>
                <p className="text-xs font-semibold text-slate-500 mb-1">Shared evidence</p>
                <ul className="list-disc pl-5 text-xs text-slate-600 space-y-1">
                  {pendingReviewSuggestion.suggestion.evidence.shared_quotes.map((quote) => (
                    <li key={`pending-review-shared-${quote.slice(0, 30)}`}>{quote}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {!pendingReviewSuggestion?.isShared &&
            Array.isArray(pendingReviewSuggestion?.suggestion?.evidence?.confidential_quotes) &&
            pendingReviewSuggestion.suggestion.evidence.confidential_quotes.length > 0 ? (
              <div>
                <p className="text-xs font-semibold text-slate-500 mb-1">Confidential evidence</p>
                <ul className="list-disc pl-5 text-xs text-slate-600 space-y-1">
                  {pendingReviewSuggestion.suggestion.evidence.confidential_quotes.map((quote) => (
                    <li key={`pending-review-conf-${quote.slice(0, 30)}`}>{quote}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onCopyPendingProposedText}
              disabled={!pendingReviewSuggestion?.nextText}
            >
              Copy proposed text
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onClosePendingReviewSuggestion}
              disabled={isApplyingReviewSuggestion}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={onConfirmCoachSuggestionApply}
              disabled={isApplyingReviewSuggestion}
            >
              {isApplyingReviewSuggestion ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Applying...
                </>
              ) : (
                'Confirm & Apply'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
