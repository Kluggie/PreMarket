import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { createPageUrl } from '@/utils';
import { documentComparisonsClient } from '@/api/documentComparisonsClient';
import { proposalsClient } from '@/api/proposalsClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import DocumentRichEditor from '@/components/document-comparison/DocumentRichEditor';
import DocumentComparisonEditorErrorBoundary from '@/components/document-comparison/DocumentComparisonEditorErrorBoundary';
import {
  buildCoachActionRequest,
  DOCUMENT_COMPARISON_COACH_ACTIONS,
} from '@/components/document-comparison/coachActions';
import { sanitizeEditorHtml } from '@/components/document-comparison/editorSanitization';
import {
  resolveComparisonUpdatedAtMs,
  resolveHydratedDraftStep,
  shouldHydrateComparisonDraft,
} from '@/pages/document-comparison/hydration';
import { buildComparisonDraftSavePayload } from '@/pages/document-comparison/draftPayload';
import {
  buildComparisonQueryPayload,
  buildOptimisticEvaluationHistoryEntry,
  defaultOwnerPermissions,
  mergeEvaluationHistoryWithOptimistic,
} from '@/pages/document-comparison/evaluationCache';
import { countWords, getDocumentComparisonTextLimits } from '@/config/aiLimits';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  FileText,
  Loader2,
  Save,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';

const CONFIDENTIAL_LABEL = 'Confidential Information';
const SHARED_LABEL = 'Shared Information';
const MAX_PREVIEW_CHARS = 500;
const TOTAL_EDITOR_STEPS = 2;
const TOTAL_WORKFLOW_STEPS = 3;
const DIFF_CONTEXT_CHARS = 220;
const STEP2_AUTOSAVE_DEBOUNCE_MS = 2500;
const STEP2_AUTOSAVE_MIN_INTERVAL_MS = 5000;
const COACH_INTENT_LABELS = {
  improve_shared: 'Improve shared writing',
  negotiate: 'Negotiation strategy',
  risks: 'Risks & Gaps',
  rewrite_selection: 'Rewrite selection',
  general: 'General improvements',
  custom_prompt: 'Custom prompt',
  company_brief: 'Company Brief',
};

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseCoachResponseBlocks(value) {
  const lines = String(value || '')
    .replace(/\r/g, '')
    .split('\n');
  const blocks = [];

  let index = 0;
  while (index < lines.length) {
    const rawLine = lines[index] || '';
    const line = rawLine.trim();
    if (!line) {
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^#{1,6}\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        text: headingMatch[1].trim(),
      });
      index += 1;
      continue;
    }

    const orderedItemMatch = line.match(/^\d+[.)]\s+(.*)$/);
    if (orderedItemMatch) {
      const items = [];
      while (index < lines.length) {
        const orderedLine = String(lines[index] || '').trim();
        const match = orderedLine.match(/^\d+[.)]\s+(.*)$/);
        if (!match) {
          break;
        }
        const itemText = String(match[1] || '').trim();
        if (itemText) {
          items.push(itemText);
        }
        index += 1;
      }
      if (items.length) {
        blocks.push({ type: 'ordered', items });
      }
      continue;
    }

    const bulletItemMatch = line.match(/^[-*]\s+(.*)$/);
    if (bulletItemMatch) {
      const items = [];
      while (index < lines.length) {
        const bulletLine = String(lines[index] || '').trim();
        const match = bulletLine.match(/^[-*]\s+(.*)$/);
        if (!match) {
          break;
        }
        const itemText = String(match[1] || '').trim();
        if (itemText) {
          items.push(itemText);
        }
        index += 1;
      }
      if (items.length) {
        blocks.push({ type: 'unordered', items });
      }
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length) {
      const paragraphLine = String(lines[index] || '');
      const paragraphLineTrimmed = paragraphLine.trim();
      if (!paragraphLineTrimmed) {
        break;
      }
      if (/^#{1,6}\s+/.test(paragraphLineTrimmed) || /^\d+[.)]\s+/.test(paragraphLineTrimmed) || /^[-*]\s+/.test(paragraphLineTrimmed)) {
        break;
      }
      paragraphLines.push(paragraphLine);
      index += 1;
    }
    if (paragraphLines.length) {
      blocks.push({
        type: 'paragraph',
        text: paragraphLines.join('\n').trim(),
      });
    } else {
      index += 1;
    }
  }

  return blocks;
}

function CoachResponseText({ text = '' }) {
  const blocks = parseCoachResponseBlocks(text);
  if (!blocks.length) {
    return <p className="text-sm leading-6 text-slate-700 whitespace-pre-wrap">{String(text || '').trim()}</p>;
  }

  return (
    <div className="space-y-3">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <h4 key={`coach-response-heading-${index}`} className="text-sm font-semibold text-slate-900">
              {block.text}
            </h4>
          );
        }
        if (block.type === 'unordered') {
          return (
            <ul key={`coach-response-unordered-${index}`} className="list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
              {block.items.map((item, itemIndex) => (
                <li key={`coach-response-unordered-item-${index}-${itemIndex}`}>{item}</li>
              ))}
            </ul>
          );
        }
        if (block.type === 'ordered') {
          return (
            <ol key={`coach-response-ordered-${index}`} className="list-decimal space-y-1 pl-5 text-sm leading-6 text-slate-700">
              {block.items.map((item, itemIndex) => (
                <li key={`coach-response-ordered-item-${index}-${itemIndex}`}>{item}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={`coach-response-paragraph-${index}`} className="text-sm leading-6 text-slate-700 whitespace-pre-wrap">
            {block.text}
          </p>
        );
      })}
    </div>
  );
}

function clampStep(value) {
  const numeric = Number(value || 1);
  if (!Number.isFinite(numeric)) {
    return 1;
  }

  return Math.min(Math.max(Math.floor(numeric), 1), TOTAL_EDITOR_STEPS);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlToText(value) {
  return String(value || '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, '')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function textToHtml(value) {
  const normalized = String(value || '').replace(/\r/g, '').trim();
  if (!normalized) {
    return '<p></p>';
  }

  const paragraphs = normalized.split(/\n{2,}/g).filter(Boolean);
  if (!paragraphs.length) {
    return '<p></p>';
  }

  return paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

function previewSnippet(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  if (text.length <= MAX_PREVIEW_CHARS) {
    return text;
  }

  return `${text.slice(0, MAX_PREVIEW_CHARS)}...`;
}

function formatFileSize(bytes) {
  const numeric = Number(bytes || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '0 B';
  }

  if (numeric < 1024) {
    return `${numeric} B`;
  }

  if (numeric < 1024 * 1024) {
    return `${(numeric / 1024).toFixed(1)} KB`;
  }

  return `${(numeric / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToMetadata(file) {
  return {
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: Number(file.size || 0),
  };
}

function parseDocJson(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  if (String(value.type || '').trim().toLowerCase() !== 'doc') {
    return null;
  }

  if (!Array.isArray(value.content)) {
    return null;
  }
  return value;
}

function buildDraftStateHash(payload) {
  return JSON.stringify({
    comparisonId: payload.comparisonId || '',
    linkedProposalId: payload.linkedProposalId || '',
    title: payload.title || '',
    docAText: payload.docAText || '',
    docBText: payload.docBText || '',
    docAHtml: payload.docAHtml || '<p></p>',
    docBHtml: payload.docBHtml || '<p></p>',
    docAJson: payload.docAJson || null,
    docBJson: payload.docBJson || null,
    docASource: payload.docASource || 'typed',
    docBSource: payload.docBSource || 'typed',
    docAFiles: Array.isArray(payload.docAFiles) ? payload.docAFiles : [],
    docBFiles: Array.isArray(payload.docBFiles) ? payload.docBFiles : [],
  });
}

function buildDraftStateHashFromSnapshot({
  comparisonId = '',
  linkedProposalId = '',
  snapshot = {},
}) {
  return buildDraftStateHash({
    comparisonId,
    linkedProposalId,
    title: snapshot.title || '',
    docAText: snapshot.docAText || '',
    docBText: snapshot.docBText || '',
    docAHtml: snapshot.docAHtml || '<p></p>',
    docBHtml: snapshot.docBHtml || '<p></p>',
    docAJson: snapshot.docAJson || null,
    docBJson: snapshot.docBJson || null,
    docASource: snapshot.docASource || 'typed',
    docBSource: snapshot.docBSource || 'typed',
    docAFiles: Array.isArray(snapshot.docAFiles) ? snapshot.docAFiles : [],
    docBFiles: Array.isArray(snapshot.docBFiles) ? snapshot.docBFiles : [],
  });
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applySuggestedTextChange({ currentText, op, nextText, headingHint, selectedText }) {
  const base = String(currentText || '');
  const incoming = String(nextText || '').trim();
  if (!incoming) {
    return base;
  }

  if (op === 'append') {
    return base.trim() ? `${base.trim()}\n\n${incoming}` : incoming;
  }

  if (op === 'replace_selection') {
    const selection = String(selectedText || '').trim();
    if (selection && base.includes(selection)) {
      return base.replace(selection, incoming);
    }
    return base.trim() ? `${base.trim()}\n\n${incoming}` : incoming;
  }

  if (op === 'insert_after_heading') {
    const hint = String(headingHint || '').trim();
    if (!hint) {
      return base.trim() ? `${base.trim()}\n\n${incoming}` : incoming;
    }
    const lines = base.split('\n');
    const index = lines.findIndex((line) => line.toLowerCase().includes(hint.toLowerCase()));
    if (index < 0) {
      return base.trim() ? `${base.trim()}\n\n${incoming}` : incoming;
    }
    const nextLines = [...lines.slice(0, index + 1), '', incoming, ...lines.slice(index + 1)];
    return nextLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  if (op === 'replace_section') {
    const hint = String(headingHint || '').trim();
    if (!hint) {
      return incoming;
    }
    const pattern = new RegExp(`${escapeRegExp(hint)}[\\s\\S]*?(?=\\n\\n[^\\n]+:|$)`, 'i');
    if (pattern.test(base)) {
      return base.replace(pattern, `${hint}\n${incoming}`).trim();
    }
    return base.trim() ? `${base.trim()}\n\n${incoming}` : incoming;
  }

  return base.trim() ? `${base.trim()}\n\n${incoming}` : incoming;
}

function buildDiffPreview(beforeText, afterText) {
  const before = String(beforeText || '');
  const after = String(afterText || '');
  if (before === after) {
    const snippet = before.length > 0 ? before.slice(0, DIFF_CONTEXT_CHARS * 2) : '(No content)';
    return {
      beforeHtml: escapeHtml(snippet),
      afterHtml: escapeHtml(snippet),
    };
  }

  let prefixLength = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (prefixLength < maxPrefix && before[prefixLength] === after[prefixLength]) {
    prefixLength += 1;
  }

  let beforeSuffixStart = before.length;
  let afterSuffixStart = after.length;
  while (
    beforeSuffixStart > prefixLength &&
    afterSuffixStart > prefixLength &&
    before[beforeSuffixStart - 1] === after[afterSuffixStart - 1]
  ) {
    beforeSuffixStart -= 1;
    afterSuffixStart -= 1;
  }

  const sliceStart = Math.max(0, prefixLength - DIFF_CONTEXT_CHARS);
  const beforeSliceEnd = Math.min(before.length, beforeSuffixStart + DIFF_CONTEXT_CHARS);
  const afterSliceEnd = Math.min(after.length, afterSuffixStart + DIFF_CONTEXT_CHARS);
  const leadingEllipsis = sliceStart > 0 ? '…' : '';
  const trailingEllipsis =
    beforeSliceEnd < before.length || afterSliceEnd < after.length ? '…' : '';

  const prefixContext = before.slice(sliceStart, prefixLength);
  const removedText = before.slice(prefixLength, beforeSuffixStart);
  const addedText = after.slice(prefixLength, afterSuffixStart);
  const suffixContext = before.slice(beforeSuffixStart, beforeSliceEnd);

  return {
    beforeHtml:
      `${leadingEllipsis}${escapeHtml(prefixContext)}` +
      `${removedText ? `<span class="bg-rose-100 text-rose-800 line-through rounded-sm px-0.5">${escapeHtml(removedText)}</span>` : ''}` +
      `${escapeHtml(suffixContext)}${trailingEllipsis}`,
    afterHtml:
      `${leadingEllipsis}${escapeHtml(prefixContext)}` +
      `${addedText ? `<span class="bg-emerald-100 text-emerald-800 rounded-sm px-0.5">${escapeHtml(addedText)}</span>` : ''}` +
      `${escapeHtml(suffixContext)}${trailingEllipsis}`,
  };
}

function getSuggestionChangeSummary(op, headingHint) {
  if (op === 'append') {
    return 'This will append text at the end of the target document.';
  }
  if (op === 'replace_selection') {
    return 'This will replace the current selected text if found, otherwise append the proposal.';
  }
  if (op === 'insert_after_heading') {
    return headingHint
      ? `This will insert text after heading "${headingHint}".`
      : 'This will insert text after a heading when available, otherwise append.';
  }
  if (op === 'replace_section') {
    return headingHint
      ? `This will replace the section matching "${headingHint}" when found.`
      : 'This will replace a section when detected, otherwise append.';
  }
  return 'This will apply the proposed text change to the target document.';
}

function getNormalizedSuggestionId(suggestion, fallbackIndex = -1) {
  const explicitId = String(suggestion?.id || '').trim();
  if (explicitId) {
    return explicitId;
  }
  const title = String(suggestion?.title || '').trim();
  const target = String(suggestion?.proposed_change?.target || '').trim();
  const text = String(suggestion?.proposed_change?.text || '').trim().slice(0, 32);
  const seed = [title, target, text, fallbackIndex >= 0 ? String(fallbackIndex) : ''].join('|');
  return seed || `suggestion-${fallbackIndex >= 0 ? fallbackIndex : 'unknown'}`;
}

function tokenizeWords(value) {
  return String(value || '')
    .trim()
    .split(/\s+/g)
    .filter(Boolean);
}

function buildWordDiffPreview(beforeText, afterText) {
  const beforeWords = tokenizeWords(beforeText);
  const afterWords = tokenizeWords(afterText);
  if (!beforeWords.length && !afterWords.length) {
    return {
      beforeHtml: '(No content)',
      afterHtml: '(No content)',
    };
  }

  const dp = Array.from({ length: beforeWords.length + 1 }, () =>
    Array.from({ length: afterWords.length + 1 }, () => 0),
  );
  for (let i = beforeWords.length - 1; i >= 0; i -= 1) {
    for (let j = afterWords.length - 1; j >= 0; j -= 1) {
      if (beforeWords[i] === afterWords[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const beforeParts = [];
  const afterParts = [];
  let i = 0;
  let j = 0;
  while (i < beforeWords.length && j < afterWords.length) {
    if (beforeWords[i] === afterWords[j]) {
      const safe = escapeHtml(beforeWords[i]);
      beforeParts.push(safe);
      afterParts.push(safe);
      i += 1;
      j += 1;
      continue;
    }

    if (dp[i + 1][j] >= dp[i][j + 1]) {
      beforeParts.push(`<span class="bg-rose-100 text-rose-800 line-through rounded-sm px-0.5">${escapeHtml(beforeWords[i])}</span>`);
      i += 1;
    } else {
      afterParts.push(`<span class="bg-emerald-100 text-emerald-800 rounded-sm px-0.5">${escapeHtml(afterWords[j])}</span>`);
      j += 1;
    }
  }

  while (i < beforeWords.length) {
    beforeParts.push(`<span class="bg-rose-100 text-rose-800 line-through rounded-sm px-0.5">${escapeHtml(beforeWords[i])}</span>`);
    i += 1;
  }
  while (j < afterWords.length) {
    afterParts.push(`<span class="bg-emerald-100 text-emerald-800 rounded-sm px-0.5">${escapeHtml(afterWords[j])}</span>`);
    j += 1;
  }

  return {
    beforeHtml: beforeParts.join(' '),
    afterHtml: afterParts.join(' '),
  };
}

function getSuggestionCategoryLabel(category) {
  const normalized = String(category || '').trim().toLowerCase();
  if (normalized === 'negotiation') {
    return 'Negotiation';
  }
  if (normalized === 'risk') {
    return 'Risk';
  }
  if (normalized === 'wording') {
    return 'Wording';
  }
  return '';
}

function toEvaluationErrorMessage(error) {
  const status = Number(error?.status || 0);
  const code = asText(
    error?.body?.error?.failure_code ||
      error?.body?.error?.code ||
      error?.body?.code ||
      error?.code,
  );
  const requestId = asText(
    error?.body?.error?.requestId ||
      error?.body?.error?.request_id ||
      error?.body?.requestId ||
      error?.body?.request_id,
  );

  if (status === 501 || code === 'not_configured') {
    return 'Evaluation is not configured in this environment yet.';
  }

  const message = asText(error?.message) || 'Evaluation failed';
  const parts = [message];
  if (code) {
    parts.push(`code: ${code}`);
  }
  if (requestId) {
    parts.push(`requestId: ${requestId}`);
  }
  return parts.join(' · ');
}

function getApiErrorCode(error) {
  return asText(error?.body?.error?.code || error?.body?.code || error?.code);
}

function isDocumentComparisonNotFoundError(error) {
  const status = Number(error?.status || 0);
  const code = getApiErrorCode(error);
  return status === 404 && code === 'document_comparison_not_found';
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

function useRouteState() {
  const location = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    const routeStep = params.get('step');

    return {
      draftId: params.get('draft') || '',
      proposalId: params.get('proposalId') || '',
      token: params.get('token') || params.get('sharedToken') || '',
      step: clampStep(routeStep || 1),
      hasStepParam: routeStep !== null,
    };
  }, [location.search]);
}

export default function DocumentComparisonCreate() {
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = useRouteState();
  const queryClient = useQueryClient();

  const step = routeState.step;
  const [comparisonId, setComparisonId] = useState(routeState.draftId);
  const [linkedProposalId, setLinkedProposalId] = useState(routeState.proposalId);

  const [title, setTitle] = useState('');
  const [docAText, setDocAText] = useState('');
  const [docBText, setDocBText] = useState('');
  const [docAHtml, setDocAHtml] = useState('<p></p>');
  const [docBHtml, setDocBHtml] = useState('<p></p>');
  const [docAJson, setDocAJson] = useState(null);
  const [docBJson, setDocBJson] = useState(null);

  const [docASource, setDocASource] = useState('typed');
  const [docBSource, setDocBSource] = useState('typed');
  const [docAFiles, setDocAFiles] = useState([]);
  const [docBFiles, setDocBFiles] = useState([]);
  const [docASelectedFile, setDocASelectedFile] = useState(null);
  const [docBSelectedFile, setDocBSelectedFile] = useState(null);
  const [docAPreviewSnippet, setDocAPreviewSnippet] = useState('');
  const [docBPreviewSnippet, setDocBPreviewSnippet] = useState('');

  const [importingSide, setImportingSide] = useState(null);
  const [uiError, setUiError] = useState('');
  const [fullscreenSide, setFullscreenSide] = useState(null);
  const [lastSavedHash, setLastSavedHash] = useState('');
  const [draftDirty, setDraftDirty] = useState(false);
  const [lastEditAt, setLastEditAt] = useState(0);
  const [coachResult, setCoachResult] = useState(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachError, setCoachError] = useState('');
  const [coachNotConfigured, setCoachNotConfigured] = useState(false);
  const [coachCached, setCoachCached] = useState(false);
  const [coachWithheldCount, setCoachWithheldCount] = useState(0);
  const [customPromptText, setCustomPromptText] = useState('');
  const [companyContextName, setCompanyContextName] = useState('');
  const [companyContextWebsite, setCompanyContextWebsite] = useState('');
  const [companyContextSaveState, setCompanyContextSaveState] = useState('idle');
  const [companyContextSaveError, setCompanyContextSaveError] = useState('');
  const [companyContextValidationError, setCompanyContextValidationError] = useState('');
  const [isSavingCompanyContext, setIsSavingCompanyContext] = useState(false);
  const [isCoachResponseCopied, setIsCoachResponseCopied] = useState(false);
  const [coachRequestMeta, setCoachRequestMeta] = useState(null);
  const [coachResultHash, setCoachResultHash] = useState('');
  const [appliedSuggestionIdsByHash, setAppliedSuggestionIdsByHash] = useState({});
  const [ignoredSuggestionIdsByHash, setIgnoredSuggestionIdsByHash] = useState({});
  const [expandedSuggestionIds, setExpandedSuggestionIds] = useState([]);
  const [selectionContext, setSelectionContext] = useState({ side: 'b', text: '', range: null });
  const [replaceSelectionRequest, setReplaceSelectionRequest] = useState({
    side: null,
    id: 0,
    from: 0,
    to: 0,
    text: '',
  });
  const [pendingSelectionApply, setPendingSelectionApply] = useState(null);
  const [focusEditorRequest, setFocusEditorRequest] = useState({ side: null, id: 0, jumpText: '' });
  const [pendingReviewSuggestion, setPendingReviewSuggestion] = useState(null);
  const [isApplyingReviewSuggestion, setIsApplyingReviewSuggestion] = useState(false);
  const [showFinishConfirmDialog, setShowFinishConfirmDialog] = useState(false);
  const [isFinishingComparison, setIsFinishingComparison] = useState(false);
  const [isRunningEvaluation, setIsRunningEvaluation] = useState(false);
  const [finishStage, setFinishStage] = useState('idle');
  const [ignoredRouteDraftId, setIgnoredRouteDraftId] = useState('');

  const docAInputFileRef = useRef(null);
  const docBInputFileRef = useRef(null);
  const companyContextNameInputRef = useRef(null);
  const docAEditorRef = useRef(null);
  const docBEditorRef = useRef(null);
  const recoveredMissingDraftIdRef = useRef('');
  const draftDirtyRef = useRef(false);
  const lastEditAtRef = useRef(0);
  const stepRef = useRef(routeState.step);
  const isDirtyRef = useRef(false);
  const comparisonIdRef = useRef(routeState.draftId || '');
  const linkedProposalIdRef = useRef(routeState.proposalId || '');
  const routeProposalIdRef = useRef(routeState.proposalId || '');
  const routeTokenRef = useRef(routeState.token || '');
  const saveMutationPendingRef = useRef(false);
  const activeSavePromiseRef = useRef(null);
  const lastStep2AutosaveAtRef = useRef(0);
  const docASpansRef = useRef([]);
  const docBSpansRef = useRef([]);
  const activeImportRequestRef = useRef({ id: 0, controller: null });
  const metadataRef = useRef({});
  const companyContextSaveTimerRef = useRef(null);
  const companyContextSavedTimerRef = useRef(null);
  const companyContextPersistedRef = useRef({
    name: '',
    website: '',
  });
  const companyContextSaveSeqRef = useRef(0);
  const latestDraftStateRef = useRef({
    title: '',
    docAText: '',
    docBText: '',
    docAHtml: '<p></p>',
    docBHtml: '<p></p>',
    docAJson: null,
    docBJson: null,
    docASource: 'typed',
    docBSource: 'typed',
    docAFiles: [],
    docBFiles: [],
  });

  const markDraftEdited = (timestamp = Date.now()) => {
    const numericTimestamp = Number(timestamp);
    const resolvedTimestamp =
      Number.isFinite(numericTimestamp) && numericTimestamp > 0
        ? numericTimestamp
        : Date.now();
    draftDirtyRef.current = true;
    lastEditAtRef.current = resolvedTimestamp;
    isDirtyRef.current = true;
    setDraftDirty(true);
    setLastEditAt(resolvedTimestamp);
  };

  const updateRouteParams = useCallback(
    ({
      nextStep,
      nextDraftId,
      nextProposalId,
      nextToken,
      replace = true,
    } = {}) => {
      const params = new URLSearchParams(location.search || '');
      let changed = false;

      if (nextStep !== undefined) {
        const normalizedStep = String(clampStep(nextStep || 1));
        if (params.get('step') !== normalizedStep) {
          params.set('step', normalizedStep);
          changed = true;
        }
      }

      if (nextDraftId !== undefined) {
        const normalizedDraftId = asText(nextDraftId);
        if (normalizedDraftId) {
          if (params.get('draft') !== normalizedDraftId) {
            params.set('draft', normalizedDraftId);
            changed = true;
          }
        } else if (params.has('draft')) {
          params.delete('draft');
          changed = true;
        }
      }

      if (nextProposalId !== undefined) {
        const normalizedProposalId = asText(nextProposalId);
        if (normalizedProposalId) {
          if (params.get('proposalId') !== normalizedProposalId) {
            params.set('proposalId', normalizedProposalId);
            changed = true;
          }
        } else if (params.has('proposalId')) {
          params.delete('proposalId');
          changed = true;
        }
      }

      if (nextToken !== undefined) {
        const normalizedToken = asText(nextToken);
        if (normalizedToken) {
          if (params.get('token') !== normalizedToken) {
            params.set('token', normalizedToken);
            changed = true;
          }
        } else if (params.has('token')) {
          params.delete('token');
          changed = true;
        }
      }

      if (!changed) {
        return false;
      }

      navigate(
        `${location.pathname}${params.toString() ? `?${params.toString()}` : ''}`,
        { replace },
      );
      return true;
    },
    [location.pathname, location.search, navigate],
  );

  const proposalLookup = useQuery({
    queryKey: ['document-comparison-proposal-lookup', routeState.proposalId],
    enabled: Boolean(routeState.proposalId),
    queryFn: () => proposalsClient.getById(routeState.proposalId),
  });

  const routeDraftId =
    routeState.draftId && routeState.draftId !== ignoredRouteDraftId ? routeState.draftId : '';
  const resolvedDraftId =
    comparisonId || routeDraftId || proposalLookup.data?.document_comparison_id || '';

  const draftQuery = useQuery({
    queryKey: ['document-comparison-draft', resolvedDraftId, routeState.token],
    enabled: Boolean(resolvedDraftId),
    queryFn: () =>
      routeState.token
        ? documentComparisonsClient.getByIdWithToken(resolvedDraftId, routeState.token)
        : documentComparisonsClient.getById(resolvedDraftId),
    retry: (failureCount, error) =>
      !isDocumentComparisonNotFoundError(error) && failureCount < 2,
  });

  useEffect(() => {
    if (!draftQuery.data?.comparison) {
      return;
    }

    const comparison = draftQuery.data.comparison;
    const serverUpdatedAtMs = resolveComparisonUpdatedAtMs(comparison);
    const canHydrateFromServer = shouldHydrateComparisonDraft({
      hasLocalUnsavedEdit: draftDirtyRef.current,
      localLastEditAt: lastEditAtRef.current,
      serverUpdatedAtMs,
    });

    if (!canHydrateFromServer) {
      if (import.meta.env.DEV) {
        console.info('[DocumentComparisonCreate] skipped stale hydration', {
          comparisonId: comparison.id || resolvedDraftId || '',
          localLastEditAt: lastEditAtRef.current,
          serverUpdatedAt:
            comparison?.updated_at || comparison?.updated_date || comparison?.updatedAt || null,
        });
      }
      return;
    }

    recoveredMissingDraftIdRef.current = '';
    if (routeState.draftId && comparison.id === routeState.draftId && ignoredRouteDraftId) {
      setIgnoredRouteDraftId('');
    }

    setComparisonId(comparison.id || resolvedDraftId || '');
    setLinkedProposalId(draftQuery.data.proposal?.id || routeState.proposalId || '');
    const hydratedCompanyName = asText(comparison.company_name || comparison.companyName || '');
    const hydratedCompanyWebsite = asText(comparison.company_website || comparison.companyWebsite || '');
    setCompanyContextName(hydratedCompanyName);
    setCompanyContextWebsite(hydratedCompanyWebsite);
    companyContextPersistedRef.current = {
      name: hydratedCompanyName,
      website: hydratedCompanyWebsite,
    };
    setCompanyContextSaveState('idle');
    setCompanyContextSaveError('');
    setCompanyContextValidationError('');

    setTitle(comparison.title || '');

    const nextDocAText = String(comparison.doc_a_text || '');
    const nextDocBText = String(comparison.doc_b_text || '');
    const nextDocAHtml = asText(comparison.doc_a_html) || textToHtml(nextDocAText);
    const nextDocBHtml = asText(comparison.doc_b_html) || textToHtml(nextDocBText);
    const nextDocAJson = parseDocJson(comparison.doc_a_json);
    const nextDocBJson = parseDocJson(comparison.doc_b_json);
    const nextDocASource = comparison.doc_a_source || 'typed';
    const nextDocBSource = comparison.doc_b_source || 'typed';
    const nextDocAFiles = Array.isArray(comparison.doc_a_files) ? comparison.doc_a_files : [];
    const nextDocBFiles = Array.isArray(comparison.doc_b_files) ? comparison.doc_b_files : [];
    docASpansRef.current = Array.isArray(comparison.doc_a_spans) ? comparison.doc_a_spans : [];
    docBSpansRef.current = Array.isArray(comparison.doc_b_spans) ? comparison.doc_b_spans : [];
    metadataRef.current =
      comparison.metadata && typeof comparison.metadata === 'object' && !Array.isArray(comparison.metadata)
        ? comparison.metadata
        : {};

    setDocAText(nextDocAText);
    setDocBText(nextDocBText);
    setDocAHtml(nextDocAHtml);
    setDocBHtml(nextDocBHtml);
    setDocAJson(nextDocAJson);
    setDocBJson(nextDocBJson);

    setDocASource(nextDocASource);
    setDocBSource(nextDocBSource);
    setDocAFiles(nextDocAFiles);
    setDocBFiles(nextDocBFiles);

    latestDraftStateRef.current = {
      title: comparison.title || '',
      docAText: nextDocAText,
      docBText: nextDocBText,
      docAHtml: nextDocAHtml,
      docBHtml: nextDocBHtml,
      docAJson: nextDocAJson,
      docBJson: nextDocBJson,
      docASource: nextDocASource,
      docBSource: nextDocBSource,
      docAFiles: nextDocAFiles,
      docBFiles: nextDocBFiles,
    };

    setDocAPreviewSnippet(previewSnippet(nextDocAText));
    setDocBPreviewSnippet(previewSnippet(nextDocBText));

    const draftStep = resolveHydratedDraftStep({
      serverDraftStep: comparison.draft_step || 1,
      routeStep: routeState.step || 1,
      localStep: stepRef.current,
      hasRouteStepParam: routeState.hasStepParam,
      maxStep: TOTAL_EDITOR_STEPS,
    });
    if (!routeState.hasStepParam) {
      updateRouteParams({ nextStep: draftStep, replace: true });
    }
    setLastSavedHash(
      buildDraftStateHashFromSnapshot({
        comparisonId: comparison.id || resolvedDraftId || '',
        linkedProposalId: draftQuery.data.proposal?.id || routeState.proposalId || '',
        snapshot: {
          title: comparison.title || '',
          docAText: nextDocAText,
          docBText: nextDocBText,
          docAHtml: nextDocAHtml,
          docBHtml: nextDocBHtml,
          docAJson: nextDocAJson,
          docBJson: nextDocBJson,
          docASource: nextDocASource,
          docBSource: nextDocBSource,
          docAFiles: nextDocAFiles,
          docBFiles: nextDocBFiles,
        },
      }),
    );
    setDraftDirty(false);
    setLastEditAt(serverUpdatedAtMs || 0);
    if (import.meta.env.DEV) {
      console.info('[DocumentComparisonCreate] hydrated draft from server', {
        comparisonId: comparison.id || resolvedDraftId || '',
        serverReturned: {
          draftStep: Number(comparison.draft_step || 1),
          updatedAt:
            comparison?.updated_at || comparison?.updated_date || comparison?.updatedAt || null,
          docATextLength: Number(String(comparison.doc_a_text || '').length),
          docBTextLength: Number(String(comparison.doc_b_text || '').length),
          hasDocAJson: Boolean(parseDocJson(comparison.doc_a_json)),
          hasDocBJson: Boolean(parseDocJson(comparison.doc_b_json)),
        },
        editorInitializedWith: {
          draftStep,
          docAContentType: nextDocAJson ? 'json' : 'html',
          docBContentType: nextDocBJson ? 'json' : 'html',
          docAHtmlLength: Number(String(nextDocAHtml || '').length),
          docBHtmlLength: Number(String(nextDocBHtml || '').length),
        },
      });
    }
  }, [
    draftQuery.data,
    ignoredRouteDraftId,
    resolvedDraftId,
    routeState.draftId,
    routeState.hasStepParam,
    routeState.proposalId,
    routeState.step,
    updateRouteParams,
  ]);

  useEffect(() => {
    if (!resolvedDraftId || !isDocumentComparisonNotFoundError(draftQuery.error)) {
      return;
    }

    if (recoveredMissingDraftIdRef.current === resolvedDraftId) {
      return;
    }
    recoveredMissingDraftIdRef.current = resolvedDraftId;

    const proposalComparisonId = asText(proposalLookup.data?.document_comparison_id);
    if (proposalComparisonId && proposalComparisonId !== resolvedDraftId) {
      if (routeState.draftId) {
        setIgnoredRouteDraftId(routeState.draftId);
      }
      setComparisonId(proposalComparisonId);
      setUiError('');
      toast.error('The previous draft was missing. Loading the latest linked draft.');
      return;
    }

    setIgnoredRouteDraftId(routeState.draftId || resolvedDraftId);
    setComparisonId('');
    setLastSavedHash('');
    docASpansRef.current = [];
    docBSpansRef.current = [];
    metadataRef.current = {};
    setUiError('This comparison draft no longer exists. Saving will create a new draft.');
    setCoachResult(null);
    setCoachError('Draft not found. Save Draft to create a new comparison, then request suggestions.');
    setCoachCached(false);
    setCoachWithheldCount(0);
    setCoachRequestMeta(null);
    setCoachResultHash('');
    toast.error('Draft not found. Save Draft to recreate it.');
  }, [
    draftQuery.error,
    proposalLookup.data?.document_comparison_id,
    resolvedDraftId,
    routeState.draftId,
  ]);

  useEffect(() => {
    if (!fullscreenSide) {
      return;
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setFullscreenSide(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullscreenSide]);

  useEffect(() => {
    latestDraftStateRef.current = {
      title: asText(title) || 'Untitled Comparison',
      docAText,
      docBText,
      docAHtml,
      docBHtml,
      docAJson,
      docBJson,
      docASource,
      docBSource,
      docAFiles: Array.isArray(docAFiles) ? docAFiles : [],
      docBFiles: Array.isArray(docBFiles) ? docBFiles : [],
    };
  }, [
    title,
    docAText,
    docBText,
    docAHtml,
    docBHtml,
    docAJson,
    docBJson,
    docASource,
    docBSource,
    docAFiles,
    docBFiles,
  ]);

  useEffect(() => {
    setCoachResult(null);
    setCoachError('');
    setCoachNotConfigured(false);
    setCoachCached(false);
    setCoachWithheldCount(0);
    setCoachRequestMeta(null);
    setCoachResultHash('');
    setAppliedSuggestionIdsByHash({});
    setIgnoredSuggestionIdsByHash({});
    setExpandedSuggestionIds([]);
    setSelectionContext({ side: 'b', text: '', range: null });
    setReplaceSelectionRequest({ side: null, id: 0, from: 0, to: 0, text: '' });
    setPendingSelectionApply(null);
    setPendingReviewSuggestion(null);
    setIsApplyingReviewSuggestion(false);
    setShowFinishConfirmDialog(false);
    setIsFinishingComparison(false);
    setIsRunningEvaluation(false);
    setFinishStage('idle');
  }, [comparisonId]);

  const currentStateHash = useMemo(
    () =>
      buildDraftStateHashFromSnapshot({
        comparisonId,
        linkedProposalId,
        snapshot: {
          title,
          docAText,
          docBText,
          docAHtml,
          docBHtml,
          docAJson,
          docBJson,
          docASource,
          docBSource,
          docAFiles,
          docBFiles,
        },
      }),
    [
      comparisonId,
      linkedProposalId,
      title,
      docAText,
      docBText,
      docAHtml,
      docBHtml,
      docAJson,
      docBJson,
      docASource,
      docBSource,
      docAFiles,
      docBFiles,
    ],
  );

  const saveDraftMutation = useMutation({
    mutationFn: async ({ stepToSave, silent = false, nonBlocking = false }) => {
      const saveStartedAtMs = Date.now();
      const savedStep = clampStep(stepToSave || step || 1);
      const activeComparisonId = asText(comparisonIdRef.current || comparisonId);
      const snapshot = latestDraftStateRef.current || {};
      const payload = buildComparisonDraftSavePayload({
        snapshot,
        fallback: {
          title,
          docAText,
          docBText,
          docAHtml,
          docBHtml,
          docAJson,
          docBJson,
          docASource,
          docBSource,
          docAFiles,
          docBFiles,
        },
        stepToSave: savedStep,
        linkedProposalId,
        routeProposalId: routeState.proposalId,
        token: routeState.token,
        partyALabel: CONFIDENTIAL_LABEL,
        partyBLabel: SHARED_LABEL,
        docASpans: docASpansRef.current,
        docBSpans: docBSpansRef.current,
        metadata: metadataRef.current,
        sanitizeHtml: sanitizeEditorHtml,
      });
      const requestedSnapshot = {
        title: asText(payload.title) || 'Untitled Comparison',
        docAText: String(payload.doc_a_text || ''),
        docBText: String(payload.doc_b_text || ''),
        docAHtml: asText(payload.doc_a_html) || textToHtml(payload.doc_a_text || ''),
        docBHtml: asText(payload.doc_b_html) || textToHtml(payload.doc_b_text || ''),
        docAJson: parseDocJson(payload.doc_a_json),
        docBJson: parseDocJson(payload.doc_b_json),
        docASource: asText(payload.doc_a_source) || 'typed',
        docBSource: asText(payload.doc_b_source) || 'typed',
        docAFiles: Array.isArray(payload.doc_a_files) ? payload.doc_a_files : [],
        docBFiles: Array.isArray(payload.doc_b_files) ? payload.doc_b_files : [],
      };

      if (import.meta.env.DEV) {
        console.info('[DocumentComparisonCreate] saveDraft called', {
          comparisonId: activeComparisonId || null,
          stepToSave: savedStep,
          nonBlocking: Boolean(nonBlocking),
          payloadKeys: Object.keys(payload).sort(),
          payloadSizes: {
            docATextLength: Number(String(payload.doc_a_text || '').length),
            docBTextLength: Number(String(payload.doc_b_text || '').length),
            docAHtmlLength: Number(String(payload.doc_a_html || '').length),
            docBHtmlLength: Number(String(payload.doc_b_html || '').length),
          },
          timestamp: new Date().toISOString(),
        });
      }

      let response;
      try {
        response = await documentComparisonsClient.saveDraft(activeComparisonId || null, payload);
      } catch (error) {
        if (!routeState.token && activeComparisonId && isDocumentComparisonNotFoundError(error)) {
          setIgnoredRouteDraftId(routeState.draftId || activeComparisonId);
          setComparisonId('');
          response = await documentComparisonsClient.create(payload);
          if (!silent) {
            toast.error('Previous draft was missing. Created a new draft.');
          }
        } else {
          throw error;
        }
      }
      const comparison = response?.comparison || response;
      if (import.meta.env.DEV) {
        console.info('[DocumentComparisonCreate] saveDraft response received', {
          attemptedComparisonId: activeComparisonId || null,
          operation: activeComparisonId ? 'update' : 'create',
          responseComparisonId: comparison?.id || null,
          draftStep: Number(comparison?.draft_step || savedStep || 1),
        });
      }

      if (!comparison?.id) {
        throw new Error('Failed to save draft');
      }

      const persistedUpdatedAtMs = resolveComparisonUpdatedAtMs(comparison);
      const persistedComparisonId = comparison.id;
      const persistedProposalId =
        comparison.proposal_id || linkedProposalId || routeState.proposalId || '';
      const persistedCompanyName = asText(
        comparison.company_name || comparison.companyName || companyContextName,
      );
      const persistedCompanyWebsite = asText(
        comparison.company_website || comparison.companyWebsite || companyContextWebsite,
      );
      const persistedTitle = asText(comparison.title) || payload.title;
      const persistedDocAText = String(comparison.doc_a_text || payload.doc_a_text || '');
      const persistedDocBText = String(comparison.doc_b_text || payload.doc_b_text || '');
      const persistedDocAHtml =
        asText(comparison.doc_a_html) || payload.doc_a_html || textToHtml(persistedDocAText);
      const persistedDocBHtml =
        asText(comparison.doc_b_html) || payload.doc_b_html || textToHtml(persistedDocBText);
      const persistedDocAJson = parseDocJson(comparison.doc_a_json);
      const persistedDocBJson = parseDocJson(comparison.doc_b_json);
      const persistedDocASource = comparison.doc_a_source || docASource || 'typed';
      const persistedDocBSource = comparison.doc_b_source || docBSource || 'typed';
      const persistedDocAFiles = Array.isArray(comparison.doc_a_files) ? comparison.doc_a_files : docAFiles;
      const persistedDocBFiles = Array.isArray(comparison.doc_b_files) ? comparison.doc_b_files : docBFiles;
      const persistedSnapshot = {
        title: persistedTitle,
        docAText: persistedDocAText,
        docBText: persistedDocBText,
        docAHtml: persistedDocAHtml,
        docBHtml: persistedDocBHtml,
        docAJson: persistedDocAJson,
        docBJson: persistedDocBJson,
        docASource: persistedDocASource,
        docBSource: persistedDocBSource,
        docAFiles: persistedDocAFiles,
        docBFiles: persistedDocBFiles,
      };
      docASpansRef.current = Array.isArray(comparison.doc_a_spans)
        ? comparison.doc_a_spans
        : Array.isArray(payload.doc_a_spans)
          ? payload.doc_a_spans
          : [];
      docBSpansRef.current = Array.isArray(comparison.doc_b_spans)
        ? comparison.doc_b_spans
        : Array.isArray(payload.doc_b_spans)
          ? payload.doc_b_spans
          : [];
      metadataRef.current =
        comparison.metadata && typeof comparison.metadata === 'object' && !Array.isArray(comparison.metadata)
          ? comparison.metadata
          : payload.metadata || {};

      setComparisonId(persistedComparisonId);
      setLinkedProposalId(persistedProposalId);
      setCompanyContextName(persistedCompanyName);
      setCompanyContextWebsite(persistedCompanyWebsite);
      companyContextPersistedRef.current = {
        name: persistedCompanyName,
        website: persistedCompanyWebsite,
      };
      setCompanyContextSaveState('idle');
      setCompanyContextSaveError('');
      comparisonIdRef.current = persistedComparisonId;
      linkedProposalIdRef.current = persistedProposalId;
      const hasNewerLocalEdits = lastEditAtRef.current > saveStartedAtMs;

      if (!nonBlocking) {
        latestDraftStateRef.current = persistedSnapshot;
        setTitle(persistedTitle);
        setDocAText(persistedDocAText);
        setDocBText(persistedDocBText);
        setDocAHtml(persistedDocAHtml);
        setDocBHtml(persistedDocBHtml);
        setDocAJson(persistedDocAJson);
        setDocBJson(persistedDocBJson);
        setDocASource(persistedDocASource);
        setDocBSource(persistedDocBSource);
        setDocAFiles(persistedDocAFiles);
        setDocBFiles(persistedDocBFiles);
        setDocAPreviewSnippet(previewSnippet(persistedDocAText));
        setDocBPreviewSnippet(previewSnippet(persistedDocBText));
        setDraftDirty(false);
        setLastEditAt(persistedUpdatedAtMs || Date.now());
        setLastSavedHash(
          buildDraftStateHashFromSnapshot({
            comparisonId: persistedComparisonId,
            linkedProposalId: persistedProposalId,
            snapshot: persistedSnapshot,
          }),
        );
      } else if (!hasNewerLocalEdits) {
        setDraftDirty(false);
        setLastEditAt(persistedUpdatedAtMs || Date.now());
        setLastSavedHash(
          buildDraftStateHashFromSnapshot({
            comparisonId: persistedComparisonId,
            linkedProposalId: persistedProposalId,
            snapshot: requestedSnapshot,
          }),
        );
      }
      if (!silent) {
        toast.success('Draft saved');
      }
      if (import.meta.env.DEV) {
        console.info('[DocumentComparisonCreate] saveDraft persisted', {
          comparisonId: persistedComparisonId,
          updated_at:
            comparison?.updated_at || comparison?.updated_date || comparison?.updatedAt || null,
          persistedDocALength: Number(String(persistedDocAText || '').length),
          persistedDocBLength: Number(String(persistedDocBText || '').length),
          timestamp: new Date().toISOString(),
        });
      }

      const cacheComparison = {
        ...comparison,
        id: persistedComparisonId,
        proposal_id: persistedProposalId || comparison?.proposal_id || comparison?.proposalId || null,
      };
      const cachedDraftPayload = buildComparisonQueryPayload({
        comparison: cacheComparison,
        proposal:
          response?.proposal ||
          draftQuery.data?.proposal ||
          (persistedProposalId
            ? {
                id: persistedProposalId,
                document_comparison_id: persistedComparisonId,
              }
            : null),
        permissions: response?.permissions || draftQuery.data?.permissions,
      });
      if (cachedDraftPayload) {
        queryClient.setQueryData(
          ['document-comparison-draft', persistedComparisonId, routeState.token],
          cachedDraftPayload,
        );
        queryClient.setQueryData(['document-comparison-detail', persistedComparisonId], cachedDraftPayload);
      }

      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      queryClient.invalidateQueries({
        queryKey: ['document-comparison-draft', persistedComparisonId, routeState.token],
      });
      return persistedComparisonId;
    },
    onError: (error, variables) => {
      if (variables?.nonBlocking) {
        return;
      }
      const message = error?.message || 'Failed to save draft';
      setUiError(message);
      toast.error(message);
    },
  });

  const runSaveDraftMutation = useCallback(
    (variables) => {
      const savePromise = saveDraftMutation.mutateAsync(variables);
      activeSavePromiseRef.current = savePromise;
      return savePromise.finally(() => {
        if (activeSavePromiseRef.current === savePromise) {
          activeSavePromiseRef.current = null;
        }
      });
    },
    [saveDraftMutation],
  );

  const waitForActiveSave = useCallback(async () => {
    const pendingSave = activeSavePromiseRef.current;
    if (!pendingSave) {
      return;
    }

    try {
      await pendingSave;
    } catch {
      // The original mutation already handled user-visible error messaging.
    }
  }, []);

  const persistLatestDraftSnapshot = useCallback(async ({ reason = 'component-unmount', stepToSave = 2 } = {}) => {
    if (saveMutationPendingRef.current || !isDirtyRef.current) {
      return null;
    }

    const savedStep = clampStep(stepToSave || stepRef.current || 1);
    const activeComparisonId = asText(comparisonIdRef.current);
    if (savedStep >= 2 && !activeComparisonId) {
      if (import.meta.env.DEV) {
        console.info('[DocumentComparisonCreate] skipped unmount save without draft id', {
          reason,
          stepToSave: savedStep,
        });
      }
      return null;
    }
    const snapshot = latestDraftStateRef.current || {};
    const payload = buildComparisonDraftSavePayload({
      snapshot,
      fallback: snapshot,
      stepToSave: savedStep,
      linkedProposalId: linkedProposalIdRef.current,
      routeProposalId: routeProposalIdRef.current,
      token: routeTokenRef.current,
      partyALabel: CONFIDENTIAL_LABEL,
      partyBLabel: SHARED_LABEL,
      docASpans: docASpansRef.current,
      docBSpans: docBSpansRef.current,
      metadata: metadataRef.current,
      sanitizeHtml: sanitizeEditorHtml,
    });

    if (import.meta.env.DEV) {
      console.info('[DocumentComparisonCreate] unmount saveDraft called', {
        reason,
        comparisonId: activeComparisonId || null,
        stepToSave: savedStep,
        payloadKeys: Object.keys(payload).sort(),
        payloadSizes: {
          docATextLength: Number(String(payload.doc_a_text || '').length),
          docBTextLength: Number(String(payload.doc_b_text || '').length),
        },
      });
    }

    try {
      const response = await documentComparisonsClient.saveDraft(activeComparisonId || null, payload);
      const comparison = response?.comparison || response;
      if (import.meta.env.DEV) {
        console.info('[DocumentComparisonCreate] unmount saveDraft persisted', {
          reason,
          comparisonId: comparison?.id || comparisonIdRef.current || null,
          updated_at:
            comparison?.updated_at || comparison?.updated_date || comparison?.updatedAt || null,
        });
      }
      return comparison?.id || null;
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[DocumentComparisonCreate] unmount saveDraft failed', {
          reason,
          comparisonId: comparisonIdRef.current || null,
          message: error?.message || 'unknown',
        });
      }
      return null;
    }
  }, []);

  useEffect(() => {
    if (lastSavedHash) {
      return;
    }

    if (draftQuery.isLoading || proposalLookup.isLoading) {
      return;
    }

    if (resolvedDraftId && !draftQuery.data?.comparison) {
      return;
    }

    setLastSavedHash(currentStateHash);
    setDraftDirty(false);
  }, [
    currentStateHash,
    draftQuery.data?.comparison,
    draftQuery.isLoading,
    lastSavedHash,
    proposalLookup.isLoading,
    resolvedDraftId,
  ]);

  useEffect(() => {
    const draftParam = comparisonId || resolvedDraftId || '';
    const proposalParam = linkedProposalId || routeState.proposalId || '';
    if (
      !draftParam &&
      !proposalParam &&
      !routeState.token &&
      !location.search
    ) {
      return;
    }
    updateRouteParams({
      nextDraftId: draftParam,
      nextProposalId: proposalParam,
      nextToken: routeState.token || '',
      replace: true,
    });
  }, [
    comparisonId,
    linkedProposalId,
    location.search,
    resolvedDraftId,
    routeState.proposalId,
    routeState.token,
    updateRouteParams,
  ]);

  const progress = (step / TOTAL_WORKFLOW_STEPS) * 100;
  const isDirty = draftDirty || currentStateHash !== lastSavedHash;
  const saveStatusLabel = saveDraftMutation.isPending
    ? 'Saving...'
    : saveDraftMutation.isError
      ? 'Error'
      : isDirty
        ? 'Unsaved changes'
        : 'Saved';
  const saveStatusClassName = saveDraftMutation.isPending
    ? 'text-blue-700'
    : saveDraftMutation.isError
      ? 'text-red-700'
      : isDirty
        ? 'text-amber-700'
        : 'text-emerald-700';
  const limits = useMemo(
    () => getDocumentComparisonTextLimits(import.meta.env?.VITE_VERTEX_MODEL || ''),
    [],
  );
  const docACharacters = docAText.length;
  const docBCharacters = docBText.length;
  const docAWords = countWords(docAText);
  const docBWords = countWords(docBText);
  const totalCharacters = docACharacters + docBCharacters;
  const docANearLimit = docACharacters >= limits.warningCharacterThreshold;
  const docBNearLimit = docBCharacters >= limits.warningCharacterThreshold;
  const totalNearLimit = totalCharacters >= limits.totalWarningCharacterThreshold;
  const docAOverLimit = docACharacters > limits.perDocumentCharacterLimit;
  const docBOverLimit = docBCharacters > limits.perDocumentCharacterLimit;
  const totalOverLimit = totalCharacters > limits.totalCharacterLimit;
  const exceedsAnySizeLimit = docAOverLimit || docBOverLimit || totalOverLimit;

  const isStep2LoadingDraft = step === 2 && Boolean(resolvedDraftId) && draftQuery.isLoading;
  const step2LoadError = step === 2 && Boolean(resolvedDraftId) ? draftQuery.error : null;
  const editableSide = String(draftQuery.data?.permissions?.editable_side || 'a').toLowerCase();
  const canUseOwnerCoach = !routeState.token && editableSide !== 'b';
  const coachSuggestions = Array.isArray(coachResult?.suggestions) ? coachResult.suggestions : [];
  const activeCoachHash = coachResultHash || 'unhashed';
  const appliedSuggestionIds = appliedSuggestionIdsByHash[activeCoachHash] || [];
  const ignoredSuggestionIds = ignoredSuggestionIdsByHash[activeCoachHash] || [];
  const hiddenSuggestionIds = new Set([...appliedSuggestionIds, ...ignoredSuggestionIds]);
  const visibleCoachSuggestions = coachSuggestions.filter(
    (suggestion, index) => !hiddenSuggestionIds.has(getNormalizedSuggestionId(suggestion, index)),
  );
  const coachResponseText = asText(coachResult?.custom_feedback || coachResult?.summary?.overall || '');
  const coachIntentKey = String(coachRequestMeta?.intent || '').toLowerCase();
  const companyBriefSources = Array.isArray(coachResult?.company_brief_sources) ? coachResult.company_brief_sources : [];
  const companyBriefLimited = Boolean(coachResult?.company_brief_limited);
  const companyContextStatusText = companyContextSaveState === 'saving'
    ? 'Saving...'
    : companyContextSaveState === 'saved'
      ? 'Saved'
      : '';
  const companyContextStatusClassName = companyContextSaveState === 'saving'
    ? 'text-blue-700'
    : companyContextSaveState === 'saved'
      ? 'text-emerald-700'
      : 'text-slate-500';
  const isCustomPromptResponse = coachIntentKey === 'custom_prompt';
  const coachResponseLabel = COACH_INTENT_LABELS[coachIntentKey] || 'Suggestion feedback';
  const coachResponseMetaParts = [];
  if (visibleCoachSuggestions.length > 0) {
    coachResponseMetaParts.push(`${visibleCoachSuggestions.length} suggestion${visibleCoachSuggestions.length === 1 ? '' : 's'}`);
  }
  if (Array.isArray(coachResult?.concerns) && coachResult.concerns.length > 0) {
    coachResponseMetaParts.push(`${coachResult.concerns.length} risk flag${coachResult.concerns.length === 1 ? '' : 's'}`);
  }
  if (coachWithheldCount > 0) {
    coachResponseMetaParts.push(`${coachWithheldCount} shared suggestion${coachWithheldCount === 1 ? '' : 's'} withheld for safety`);
  }
  if (coachIntentKey === 'company_brief' && companyBriefSources.length > 0) {
    coachResponseMetaParts.push(`${companyBriefSources.length} source${companyBriefSources.length === 1 ? '' : 's'}`);
  }
  if (coachIntentKey === 'company_brief' && companyBriefLimited) {
    coachResponseMetaParts.push('Limited public info found');
  }
  const coachResponseMeta = coachResponseMetaParts.join(' · ');

  useEffect(() => {
    draftDirtyRef.current = draftDirty;
  }, [draftDirty]);

  useEffect(() => {
    lastEditAtRef.current = lastEditAt;
  }, [lastEditAt]);

  useEffect(() => {
    stepRef.current = step;
    isDirtyRef.current = isDirty;
  }, [isDirty, step]);

  useEffect(() => {
    comparisonIdRef.current = comparisonId;
  }, [comparisonId]);

  useEffect(() => {
    linkedProposalIdRef.current = linkedProposalId;
  }, [linkedProposalId]);

  useEffect(() => {
    routeProposalIdRef.current = routeState.proposalId;
    routeTokenRef.current = routeState.token;
  }, [routeState.proposalId, routeState.token]);

  useEffect(() => {
    saveMutationPendingRef.current = saveDraftMutation.isPending;
  }, [saveDraftMutation.isPending]);

  useEffect(
    () => () => {
      if (activeImportRequestRef.current.controller) {
        activeImportRequestRef.current.controller.abort();
        activeImportRequestRef.current.controller = null;
      }
    },
    [],
  );

  useEffect(
    () => () => {
      if (companyContextSaveTimerRef.current) {
        clearTimeout(companyContextSaveTimerRef.current);
        companyContextSaveTimerRef.current = null;
      }
      if (companyContextSavedTimerRef.current) {
        clearTimeout(companyContextSavedTimerRef.current);
        companyContextSavedTimerRef.current = null;
      }
    },
    [],
  );

  const applyImportedContent = (side, file, extracted) => {
    const rawText = asText(extracted?.text) || htmlToText(extracted?.html || '');
    const html = sanitizeEditorHtml(asText(extracted?.html) || textToHtml(rawText));
    const text = rawText || htmlToText(html);

    if (!text && !html) {
      throw new Error('No readable content was extracted from the selected file');
    }

    if (side === 'a') {
      latestDraftStateRef.current = {
        ...latestDraftStateRef.current,
        docAText: text,
        docAHtml: html,
        docAJson: null,
        docASource: 'uploaded',
        docAFiles: [fileToMetadata(file)],
      };
      setDocAText(text);
      setDocAHtml(html);
      setDocAJson(null);
      setDocASource('uploaded');
      setDocAFiles([fileToMetadata(file)]);
      setDocAPreviewSnippet(previewSnippet(text || htmlToText(html)));
      markDraftEdited();
      return;
    }

    latestDraftStateRef.current = {
      ...latestDraftStateRef.current,
      docBText: text,
      docBHtml: html,
      docBJson: null,
      docBSource: 'uploaded',
      docBFiles: [fileToMetadata(file)],
    };
    setDocBText(text);
    setDocBHtml(html);
    setDocBJson(null);
    setDocBSource('uploaded');
    setDocBFiles([fileToMetadata(file)]);
    setDocBPreviewSnippet(previewSnippet(text || htmlToText(html)));
    markDraftEdited();
  };

  const importForSide = async (side, fileOverride = null) => {
    const selectedFile = fileOverride || (side === 'a' ? docASelectedFile : docBSelectedFile);
    if (!selectedFile) {
      toast.error('Select a .docx or .pdf file first.');
      return;
    }

    try {
      documentComparisonsClient.validateImportFile(selectedFile);
    } catch (error) {
      const message = error?.message || 'Failed to import file';
      setUiError(message);
      toast.error(message);
      return;
    }

    if (activeImportRequestRef.current.controller) {
      activeImportRequestRef.current.controller.abort();
    }
    const nextController = new AbortController();
    const nextRequestId = activeImportRequestRef.current.id + 1;
    activeImportRequestRef.current = {
      id: nextRequestId,
      controller: nextController,
    };

    setUiError('');
    setImportingSide(side);

    try {
      const extracted = await documentComparisonsClient.extractDocumentFromFile(selectedFile, {
        signal: nextController.signal,
      });

      if (
        nextController.signal.aborted ||
        activeImportRequestRef.current.id !== nextRequestId
      ) {
        return;
      }

      applyImportedContent(side, selectedFile, extracted);
      toast.success(`${selectedFile.name} imported`);
    } catch (error) {
      if (
        nextController.signal.aborted ||
        activeImportRequestRef.current.id !== nextRequestId ||
        isAbortError(error)
      ) {
        return;
      }
      const message = error?.message || 'Failed to import file';
      setUiError(message);
      toast.error(message);
    } finally {
      if (activeImportRequestRef.current.id === nextRequestId) {
        activeImportRequestRef.current = {
          id: nextRequestId,
          controller: null,
        };
        setImportingSide(null);
      }
    }
  };

  const bestEffortSaveDraft = useCallback(
    async ({ reason = 'navigation', stepToSave = stepRef.current, requireDraftId = false } = {}) => {
      if (saveMutationPendingRef.current) {
        await waitForActiveSave();
      }

      const savedStep = clampStep(stepToSave || stepRef.current || 1);
      const activeComparisonId = asText(comparisonIdRef.current);
      if (requireDraftId && !activeComparisonId) {
        if (import.meta.env.DEV) {
          console.info('[DocumentComparisonCreate] best-effort save skipped without draft id', {
            reason,
            stepToSave: savedStep,
          });
        }
        return null;
      }
      if (!isDirtyRef.current) {
        return activeComparisonId || null;
      }

      try {
        const savedId = await runSaveDraftMutation({
          stepToSave: savedStep,
          silent: true,
          nonBlocking: true,
        });
        if (import.meta.env.DEV) {
          console.info('[DocumentComparisonCreate] best-effort save completed', {
            reason,
            stepToSave: savedStep,
            comparisonId: savedId || comparisonIdRef.current || null,
          });
        }
        return asText(savedId || comparisonIdRef.current) || null;
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn('[DocumentComparisonCreate] best-effort save failed', {
            reason,
            stepToSave: savedStep,
            message: error?.message || 'unknown',
          });
        }
        return null;
      }
    },
    [runSaveDraftMutation, waitForActiveSave],
  );

  const ensureStep2DraftId = useCallback(async () => {
    const existingId = asText(comparisonIdRef.current);
    if (existingId) {
      return existingId;
    }

    const createdId = await runSaveDraftMutation({
      stepToSave: 2,
      silent: true,
    });
    const persistedId = asText(createdId || comparisonIdRef.current);
    if (!persistedId) {
      throw new Error('Failed to create comparison draft');
    }
    return persistedId;
  }, [runSaveDraftMutation]);

  const jumpStep = async (nextStep) => {
    const bounded = clampStep(nextStep || 1);
    const currentStep = clampStep(stepRef.current || step || 1);
    const hadDraftIdBeforeTransition = Boolean(asText(comparisonIdRef.current));
    if (saveMutationPendingRef.current) {
      await waitForActiveSave();
    }

    if (bounded === 2) {
      try {
        await ensureStep2DraftId();
      } catch (error) {
        const message = error?.message || "Couldn't open editor yet. Please retry.";
        setUiError(message);
        toast.error(message);
        return;
      }
    }

    const shouldSaveBeforeNavigation =
      isDirtyRef.current &&
      currentStep !== bounded &&
      !(currentStep === 1 && bounded === 2 && !hadDraftIdBeforeTransition);

    if (shouldSaveBeforeNavigation) {
      await bestEffortSaveDraft({
        reason: `step-navigation-from-step-${currentStep}`,
        stepToSave: Math.max(2, currentStep),
        requireDraftId: currentStep >= 2,
      });
    }

    updateRouteParams({ nextStep: bounded, replace: true });
  };

  const retryStep2Load = () => {
    setUiError('');
    setFullscreenSide(null);
    updateRouteParams({ nextStep: 2, replace: true });
    if (resolvedDraftId) {
      queryClient.invalidateQueries({ queryKey: ['document-comparison-draft', resolvedDraftId, routeState.token] });
    }
  };

  const saveDraft = async (stepToSave = step) => {
    if (exceedsAnySizeLimit) {
      toast.error(
        `Document content exceeds the ${limits.model} limit. Reduce text before saving.`,
      );
      return;
    }
    try {
      await runSaveDraftMutation({ stepToSave });
    } catch {
      // Error toast is handled by mutation onError.
    }
  };

  const handleStep2SaveDraftClick = async () => {
    // Capture content directly from Tiptap editor instances for latest, most reliable state
    const docAEditor = docAEditorRef.current;
    const docBEditor = docBEditorRef.current;

    const editorAText = docAEditor?.getText({ blockSeparator: '\n\n' }).trim() || '';
    const editorAHtml = docAEditor?.getHTML() || '';
    const editorAJson = docAEditor?.getJSON() || null;

    const editorBText = docBEditor?.getText({ blockSeparator: '\n\n' }).trim() || '';
    const editorBHtml = docBEditor?.getHTML() || '';
    const editorBJson = docBEditor?.getJSON() || null;

    // Update state ref with the latest content from editors
    latestDraftStateRef.current = {
      ...latestDraftStateRef.current,
      title,
      docAText: editorAText,
      docBText: editorBText,
      docAHtml: editorAHtml,
      docBHtml: editorBHtml,
      docAJson: editorAJson,
      docBJson: editorBJson,
      docASource,
      docBSource,
      docAFiles: Array.isArray(docAFiles) ? docAFiles : [],
      docBFiles: Array.isArray(docBFiles) ? docBFiles : [],
    };

    // Validation: warn if both editors are completely empty when overwriting existing comparison
    const hasDocAContent = Boolean(editorAText.trim());
    const hasDocBContent = Boolean(editorBText.trim());
    const isNewComparison = !comparisonId;

    if (!hasDocAContent && !hasDocBContent && !isNewComparison) {
      toast.warning('Cannot save: both documents are empty. Add content to at least one document.');
      return;
    }

    // Allow saving empty drafts for new comparisons (user can fill in later)
    // But warn if user tries to save completely empty when creating new
    if (!hasDocAContent && !hasDocBContent && isNewComparison) {
      toast.info('You are creating an empty draft. Add content before proceeding to evaluation.');
    }

    if (import.meta.env.DEV) {
      console.info('[DocumentComparisonCreate] Save Draft from Tiptap editors', {
        comparisonId: comparisonId || null,
        isNewComparison,
        capturedFromEditor: {
          docATextLength: Number(editorAText.length),
          docBTextLength: Number(editorBText.length),
          hasDocAJson: Boolean(editorAJson),
          hasDocBJson: Boolean(editorBJson),
        },
        timestamp: new Date().toISOString(),
      });
    }

    await saveDraft(2);
  };

  const buildEvaluationPayload = () => {
    const snapshot = latestDraftStateRef.current || {};
    const normalizedTitle = asText(snapshot.title || title) || 'Untitled Comparison';
    const sanitizedDocAHtml = sanitizeEditorHtml(snapshot.docAHtml || docAHtml || textToHtml(snapshot.docAText || docAText));
    const sanitizedDocBHtml = sanitizeEditorHtml(snapshot.docBHtml || docBHtml || textToHtml(snapshot.docBText || docBText));
    const normalizedDocAText = String(snapshot.docAText || docAText || htmlToText(sanitizedDocAHtml) || '');
    const normalizedDocBText = String(snapshot.docBText || docBText || htmlToText(sanitizedDocBHtml) || '');

    return {
      title: normalizedTitle,
      draft_step: 2,
      party_a_label: CONFIDENTIAL_LABEL,
      party_b_label: SHARED_LABEL,
      doc_a_text: normalizedDocAText,
      doc_b_text: normalizedDocBText,
      doc_a_html: sanitizedDocAHtml,
      doc_b_html: sanitizedDocBHtml,
      doc_a_json: snapshot.docAJson || docAJson || null,
      doc_b_json: snapshot.docBJson || docBJson || null,
      doc_a_source: asText(snapshot.docASource || docASource) || 'typed',
      doc_b_source: asText(snapshot.docBSource || docBSource) || 'typed',
      doc_a_files: Array.isArray(snapshot.docAFiles) ? snapshot.docAFiles : docAFiles,
      doc_b_files: Array.isArray(snapshot.docBFiles) ? snapshot.docBFiles : docBFiles,
    };
  };

  const finishToComparisonDetail = async () => {
    if (isFinishingComparison) {
      return;
    }
    if (exceedsAnySizeLimit) {
      toast.error(
        `Document content exceeds the ${limits.model} limit. Reduce text before saving.`,
      );
      return;
    }

    setIsFinishingComparison(true);
    setFinishStage('saving');
    setIsRunningEvaluation(false);
    try {
      let resolvedId = await runSaveDraftMutation({
        stepToSave: 2,
        silent: true,
      });
      if (!resolvedId) {
        resolvedId = asText(comparisonId);
      }

      if (!resolvedId) {
        throw new Error('Unable to open the comparison details yet.');
      }

      const evaluationPayload = buildEvaluationPayload();
      let evaluationResponse = null;
      setFinishStage('evaluating');
      setIsRunningEvaluation(true);
      try {
        evaluationResponse = await documentComparisonsClient.evaluate(resolvedId, evaluationPayload);
      } catch (error) {
        if (isDocumentComparisonNotFoundError(error)) {
          const recreatedId = await runSaveDraftMutation({
            stepToSave: 2,
            silent: true,
          });
          if (recreatedId) {
            resolvedId = recreatedId;
            evaluationResponse = await documentComparisonsClient.evaluate(resolvedId, evaluationPayload);
          } else {
            throw error;
          }
        } else {
          toast.error(toEvaluationErrorMessage(error));
        }
      } finally {
        setIsRunningEvaluation(false);
      }

      const evaluatedComparison = evaluationResponse?.comparison || null;
      const evaluatedProposal = evaluationResponse?.proposal || null;
      const evaluatedInputTrace = evaluationResponse?.evaluationInputTrace || null;
      if (evaluatedComparison?.id) {
        const cachedDetailPayload = buildComparisonQueryPayload({
          comparison: evaluatedComparison,
          proposal:
            evaluatedProposal ||
            draftQuery.data?.proposal ||
            (asText(evaluatedComparison.proposal_id || linkedProposalId || routeState.proposalId)
              ? {
                  id: asText(
                    evaluatedComparison.proposal_id || linkedProposalId || routeState.proposalId,
                  ),
                  document_comparison_id: evaluatedComparison.id,
                }
              : null),
          permissions: draftQuery.data?.permissions || defaultOwnerPermissions(),
        });
        if (cachedDetailPayload) {
          queryClient.setQueryData(
            ['document-comparison-draft', evaluatedComparison.id, routeState.token],
            cachedDetailPayload,
          );
          queryClient.setQueryData(
            ['document-comparison-detail', evaluatedComparison.id],
            cachedDetailPayload,
          );
        }

        const proposalIdForHistory = asText(
          evaluatedProposal?.id ||
            evaluatedComparison.proposal_id ||
            linkedProposalId ||
            routeState.proposalId,
        );
        if (proposalIdForHistory) {
          const optimisticEntry = buildOptimisticEvaluationHistoryEntry({
            comparison: evaluatedComparison,
            proposalId: proposalIdForHistory,
            evaluationInputTrace: evaluatedInputTrace,
          });
          if (optimisticEntry) {
            queryClient.setQueryData(
              ['document-comparison-proposal-evaluations', evaluatedComparison.id, proposalIdForHistory],
              (current) => mergeEvaluationHistoryWithOptimistic(current, optimisticEntry),
            );
          }
          queryClient.invalidateQueries({
            queryKey: ['document-comparison-proposal-evaluations', evaluatedComparison.id, proposalIdForHistory],
          });
        }

        queryClient.invalidateQueries({
          queryKey: ['document-comparison-detail', evaluatedComparison.id],
        });
      }

      setShowFinishConfirmDialog(false);
      navigate(createPageUrl(`DocumentComparisonDetail?id=${encodeURIComponent(resolvedId)}`));
    } catch (error) {
      const message = error?.message || 'Failed to open comparison details.';
      setUiError(message);
      toast.error(message);
    } finally {
      setFinishStage('idle');
      setIsRunningEvaluation(false);
      setIsFinishingComparison(false);
    }
  };

  const handleFinishClick = () => {
    if (saveDraftMutation.isPending || isFinishingComparison || isRunningEvaluation) {
      return;
    }
    if (isDirty) {
      setShowFinishConfirmDialog(true);
      return;
    }
    finishToComparisonDetail();
  };

  const ensureComparisonIdForCoach = useCallback(async () => {
    if (comparisonId && !isDocumentComparisonNotFoundError(draftQuery.error)) {
      return comparisonId;
    }
    try {
      const createdId = await runSaveDraftMutation({
        stepToSave: Math.max(2, clampStep(step || 2)),
        silent: true,
      });
      return createdId || '';
    } catch (error) {
      const message = error?.message || "Couldn't prepare AI Coach yet. Save the draft and retry.";
      setCoachError(message);
      toast.error(message);
      return '';
    }
  }, [comparisonId, draftQuery.error, runSaveDraftMutation, step]);

  const updateCompanyContextInDraftCache = useCallback(
    (nextComparisonId, nextCompanyName, nextCompanyWebsite) => {
      const normalizedId = asText(nextComparisonId);
      if (!normalizedId) {
        return;
      }

      const normalizedName = asText(nextCompanyName);
      const normalizedWebsite = asText(nextCompanyWebsite);
      const cacheKeys = [
        ['document-comparison-draft', normalizedId, routeState.token || ''],
      ];
      if (routeState.token) {
        cacheKeys.push(['document-comparison-draft', normalizedId, '']);
      }

      cacheKeys.forEach((queryKey) => {
        const existing = queryClient.getQueryData(queryKey);
        if (!existing || typeof existing !== 'object') {
          return;
        }

        queryClient.setQueryData(queryKey, (currentValue) => {
          if (!currentValue || typeof currentValue !== 'object') {
            return currentValue;
          }
          const currentComparison =
            currentValue.comparison && typeof currentValue.comparison === 'object'
              ? currentValue.comparison
              : null;
          if (!currentComparison) {
            return currentValue;
          }
          return {
            ...currentValue,
            comparison: {
              ...currentComparison,
              company_name: normalizedName || null,
              company_website: normalizedWebsite || null,
              companyName: normalizedName || null,
              companyWebsite: normalizedWebsite || null,
            },
          };
        });
      });
    },
    [queryClient, routeState.token],
  );

  const flushCompanyContextSave = useCallback(
    async ({
      showValidation = false,
      comparisonIdOverride = '',
    } = {}) => {
      const trimmedCompanyName = asText(companyContextName);
      const trimmedWebsite = asText(companyContextWebsite);
      const persistedName = asText(companyContextPersistedRef.current.name);
      const persistedWebsite = asText(companyContextPersistedRef.current.website);
      const hasChanges =
        trimmedCompanyName !== persistedName || trimmedWebsite !== persistedWebsite;

      if (!hasChanges) {
        setCompanyContextSaveError('');
        if (companyContextSaveState === 'error' || companyContextSaveState === 'saving') {
          setCompanyContextSaveState('idle');
        }
        return true;
      }

      if (!trimmedCompanyName) {
        if (showValidation && (trimmedWebsite || persistedName || persistedWebsite)) {
          setCompanyContextSaveState('error');
          setCompanyContextSaveError('Company name is required to save context.');
        } else {
          setCompanyContextSaveState('idle');
          setCompanyContextSaveError('');
        }
        return false;
      }

      const resolvedId =
        asText(comparisonIdOverride) || (await ensureComparisonIdForCoach());
      if (!resolvedId) {
        setCompanyContextSaveState('error');
        setCompanyContextSaveError('Could not save company context. Save the draft and retry.');
        return false;
      }

      const saveSeq = companyContextSaveSeqRef.current + 1;
      companyContextSaveSeqRef.current = saveSeq;
      setIsSavingCompanyContext(true);
      setCompanyContextSaveState('saving');
      setCompanyContextSaveError('');

      if (companyContextSavedTimerRef.current) {
        clearTimeout(companyContextSavedTimerRef.current);
        companyContextSavedTimerRef.current = null;
      }

      try {
        const response = await documentComparisonsClient.updateCompanyContext(resolvedId, {
          companyName: trimmedCompanyName,
          website: trimmedWebsite || undefined,
        });

        if (companyContextSaveSeqRef.current !== saveSeq) {
          return true;
        }

        const persistedCompanyName = asText(
          response?.companyContext?.company_name || trimmedCompanyName,
        );
        const persistedCompanyWebsite = asText(
          response?.companyContext?.company_website || trimmedWebsite,
        );

        setCompanyContextName(persistedCompanyName);
        setCompanyContextWebsite(persistedCompanyWebsite);
        companyContextPersistedRef.current = {
          name: persistedCompanyName,
          website: persistedCompanyWebsite,
        };
        setCompanyContextSaveState('saved');
        setCompanyContextSaveError('');
        updateCompanyContextInDraftCache(
          resolvedId,
          persistedCompanyName,
          persistedCompanyWebsite,
        );
        queryClient.invalidateQueries({
          queryKey: ['document-comparison-detail', resolvedId],
        });

        companyContextSavedTimerRef.current = setTimeout(() => {
          setCompanyContextSaveState((current) =>
            current === 'saved' ? 'idle' : current,
          );
          companyContextSavedTimerRef.current = null;
        }, 1600);

        return true;
      } catch (error) {
        if (companyContextSaveSeqRef.current !== saveSeq) {
          return false;
        }
        const message = error?.message || 'Failed to save company context.';
        setCompanyContextSaveState('error');
        setCompanyContextSaveError(message);
        return false;
      } finally {
        if (companyContextSaveSeqRef.current === saveSeq) {
          setIsSavingCompanyContext(false);
        }
      }
    },
    [
      companyContextName,
      companyContextSaveState,
      companyContextWebsite,
      ensureComparisonIdForCoach,
      queryClient,
      updateCompanyContextInDraftCache,
    ],
  );

  const flushCompanyContextSaveNow = useCallback(
    (options = {}) => {
      if (companyContextSaveTimerRef.current) {
        clearTimeout(companyContextSaveTimerRef.current);
        companyContextSaveTimerRef.current = null;
      }
      return flushCompanyContextSave(options);
    },
    [flushCompanyContextSave],
  );

  const handleCompanyContextBlur = useCallback(() => {
    flushCompanyContextSaveNow({ showValidation: true }).catch(() => {});
  }, [flushCompanyContextSaveNow]);

  const retryCompanyContextSave = useCallback(() => {
    flushCompanyContextSaveNow({ showValidation: true }).catch(() => {});
  }, [flushCompanyContextSaveNow]);

  const handleCompanyContextNameChange = useCallback((event) => {
    setCompanyContextName(event.target.value);
    setCompanyContextValidationError('');
  }, []);

  const handleCompanyContextWebsiteChange = useCallback((event) => {
    setCompanyContextWebsite(event.target.value);
    setCompanyContextValidationError('');
  }, []);

  const runCoach = async ({
    action = '',
    mode = 'full',
    intent = 'general',
    promptText = '',
    selectionText = '',
    selectionTarget = null,
    selectionRange = null,
    silent = false,
  } = {}) => {
    if (coachNotConfigured) {
      return null;
    }

    const resolvedId = await ensureComparisonIdForCoach();
    if (!resolvedId) {
      return null;
    }

    if (asText(companyContextName)) {
      await flushCompanyContextSaveNow({
        showValidation: false,
        comparisonIdOverride: resolvedId,
      });
    }

    setCoachLoading(true);
    setCoachError('');
    setIsCoachResponseCopied(false);

    try {
      const normalizedAction = String(action || intent || '').trim().toLowerCase();
      const isCustomPromptRequest = normalizedAction === 'custom_prompt';
      const payload = {
        action: action || undefined,
        mode,
        intent,
        promptText: isCustomPromptRequest ? String(promptText || '').trim() : undefined,
        selectionText: selectionText || undefined,
        selectionTarget: selectionTarget || undefined,
      };
      if (!isCustomPromptRequest) {
        const sanitizedDocAHtml = sanitizeEditorHtml(docAHtml || textToHtml(docAText));
        const sanitizedDocBHtml = sanitizeEditorHtml(docBHtml || textToHtml(docBText));
        const normalizedDocAText = asText(docAText) || htmlToText(sanitizedDocAHtml);
        const normalizedDocBText = asText(docBText) || htmlToText(sanitizedDocBHtml);
        payload.doc_a_text = normalizedDocAText;
        payload.doc_b_text = normalizedDocBText;
        payload.doc_a_html = sanitizedDocAHtml;
        payload.doc_b_html = sanitizedDocBHtml;
      }
      const response = await documentComparisonsClient.coach(resolvedId, payload);
      const coach = response?.coach || null;
      setCoachResult(coach);
      setCoachResultHash(String(response?.cacheHash || ''));
      setCoachCached(Boolean(response?.cached));
      setCoachWithheldCount(Number(response?.withheldCount || 0));
      setCoachNotConfigured(false);
      setCoachRequestMeta({
        action: action || '',
        mode,
        intent,
        promptText: isCustomPromptRequest ? String(promptText || '').trim() : '',
        model: response?.model || 'unknown',
        provider: response?.provider || 'vertex',
        selectionText: selectionText || '',
        selectionTarget: selectionTarget || null,
        selectionRange:
          selectionRange && Number.isFinite(selectionRange.from) && Number.isFinite(selectionRange.to)
            ? {
                from: Number(selectionRange.from),
                to: Number(selectionRange.to),
              }
            : null,
      });
      setExpandedSuggestionIds([]);
      if (!silent) {
        toast.success(response?.cached ? 'Loaded cached suggestions' : 'Suggestions ready');
      }
      return response;
    } catch (error) {
      const status = Number(error?.status || 0);
      const code = asText(error?.body?.error?.code || error?.body?.code || error?.code);
      if (status === 501 || code === 'not_configured') {
        const message = 'AI suggestions are unavailable because Vertex AI is not configured.';
        setCoachResult(null);
        setCoachResultHash('');
        setCoachCached(false);
        setCoachWithheldCount(0);
        setCoachRequestMeta(null);
        setExpandedSuggestionIds([]);
        setCoachError(message);
        setCoachNotConfigured(true);
        if (!silent && !coachNotConfigured) {
          toast.error(message);
        }
        return null;
      }

      if (status === 404 && code === 'document_comparison_not_found') {
        setIgnoredRouteDraftId(routeState.draftId || resolvedId);
        setComparisonId('');
        const message = 'Draft not found. Save Draft to create a new comparison and retry.';
        setCoachResult(null);
        setCoachResultHash('');
        setCoachCached(false);
        setCoachWithheldCount(0);
        setCoachRequestMeta(null);
        setExpandedSuggestionIds([]);
        setCoachError(message);
        if (!silent) {
          toast.error(message);
        }
        return null;
      }

      const message = error?.message || 'Suggestion request failed';
      setCoachError(message);
      if (!silent) {
        toast.error(message);
      }
      return null;
    } finally {
      setCoachLoading(false);
    }
  };

  const runCompanyBrief = async ({
    comparisonIdOverride = '',
    silent = false,
  } = {}) => {
    if (coachNotConfigured) {
      return null;
    }

    const resolvedId = asText(comparisonIdOverride) || (await ensureComparisonIdForCoach());
    if (!resolvedId) {
      return null;
    }

    if (!asText(companyContextName)) {
      setCompanyContextValidationError('Company name is required for Company Brief');
      companyContextNameInputRef.current?.focus?.();
      return null;
    }
    setCompanyContextValidationError('');

    const companyContextSaved = await flushCompanyContextSaveNow({
      showValidation: true,
      comparisonIdOverride: resolvedId,
    });
    if (!companyContextSaved) {
      return null;
    }

    setCoachLoading(true);
    setCoachError('');
    setIsCoachResponseCopied(false);

    try {
      const response = await documentComparisonsClient.companyBrief(resolvedId, {
        lens: 'risk_negotiation',
      });
      const brief = response?.companyBrief || {};
      const feedbackText = asText(brief.content);
      const sources = Array.isArray(brief.sources) ? brief.sources : [];
      const searches = Array.isArray(brief.searches) ? brief.searches : [];
      const limited = Boolean(brief.limited);
      const fallbackText = limited
        ? 'Limited public info found.'
        : 'Company brief completed.';

      setCoachResult({
        version: 'coach-v1',
        summary: {
          overall: feedbackText || fallbackText,
          top_priorities: [],
        },
        suggestions: [],
        concerns: [],
        questions: [],
        negotiation_moves: [],
        custom_feedback: feedbackText || fallbackText,
        company_brief_sources: sources,
        company_brief_searches: searches,
        company_brief_limited: limited,
      });
      setCoachResultHash('');
      setCoachCached(false);
      setCoachWithheldCount(0);
      setCoachNotConfigured(false);
      setCoachRequestMeta({
        action: 'company_brief',
        mode: 'full',
        intent: 'company_brief',
        promptText: '',
        model: response?.model || 'unknown',
        provider: response?.provider || 'vertex',
        selectionText: '',
        selectionTarget: null,
        selectionRange: null,
      });
      setExpandedSuggestionIds([]);
      if (!silent) {
        toast.success('Company brief ready');
      }
      return response;
    } catch (error) {
      const status = Number(error?.status || 0);
      const code = asText(error?.body?.error?.code || error?.body?.code || error?.code);
      if (status === 400 && code === 'missing_company_context') {
        setCompanyContextValidationError('Company name is required for Company Brief');
        companyContextNameInputRef.current?.focus?.();
        const message = 'Company name is required for Company Brief.';
        setCoachError(message);
        if (!silent) {
          toast.error('Company context is missing.');
        }
        return null;
      }

      if (status === 501 || code === 'not_configured') {
        const message = 'AI suggestions are unavailable because Vertex AI is not configured.';
        setCoachResult(null);
        setCoachResultHash('');
        setCoachCached(false);
        setCoachWithheldCount(0);
        setCoachRequestMeta(null);
        setExpandedSuggestionIds([]);
        setCoachError(message);
        setCoachNotConfigured(true);
        if (!silent && !coachNotConfigured) {
          toast.error(message);
        }
        return null;
      }

      if (status === 404 && code === 'document_comparison_not_found') {
        setIgnoredRouteDraftId(routeState.draftId || resolvedId);
        setComparisonId('');
        const message = 'Draft not found. Save Draft to create a new comparison and retry.';
        setCoachResult(null);
        setCoachResultHash('');
        setCoachCached(false);
        setCoachWithheldCount(0);
        setCoachRequestMeta(null);
        setExpandedSuggestionIds([]);
        setCoachError(message);
        if (!silent) {
          toast.error(message);
        }
        return null;
      }

      const message = error?.message || 'Company brief request failed';
      setCoachError(message);
      if (!silent) {
        toast.error(message);
      }
      return null;
    } finally {
      setCoachLoading(false);
    }
  };

  const handleCompanyBriefAction = () => {
    if (coachLoading || coachNotConfigured) {
      return;
    }

    runCompanyBrief();
  };

  useEffect(() => {
    if (step !== 2 || !canUseOwnerCoach) {
      if (companyContextSaveTimerRef.current) {
        clearTimeout(companyContextSaveTimerRef.current);
        companyContextSaveTimerRef.current = null;
      }
      return;
    }

    const trimmedCompanyName = asText(companyContextName);
    const trimmedWebsite = asText(companyContextWebsite);
    const persistedName = asText(companyContextPersistedRef.current.name);
    const persistedWebsite = asText(companyContextPersistedRef.current.website);
    const hasChanges =
      trimmedCompanyName !== persistedName || trimmedWebsite !== persistedWebsite;

    if (companyContextSaveTimerRef.current) {
      clearTimeout(companyContextSaveTimerRef.current);
      companyContextSaveTimerRef.current = null;
    }

    if (!hasChanges || !trimmedCompanyName) {
      return;
    }

    companyContextSaveTimerRef.current = setTimeout(() => {
      flushCompanyContextSave({
        showValidation: false,
      }).catch(() => {});
      companyContextSaveTimerRef.current = null;
    }, 750);

    return () => {
      if (companyContextSaveTimerRef.current) {
        clearTimeout(companyContextSaveTimerRef.current);
        companyContextSaveTimerRef.current = null;
      }
    };
  }, [
    canUseOwnerCoach,
    companyContextName,
    companyContextWebsite,
    flushCompanyContextSave,
    step,
  ]);

  const runCustomPromptCoach = () => {
    const promptText = asText(customPromptText);
    if (!promptText || coachLoading || coachNotConfigured) {
      return;
    }
    runCoach({
      action: 'custom_prompt',
      mode: 'full',
      intent: 'custom_prompt',
      promptText,
    });
  };

  const handleCustomPromptKeyDown = (event) => {
    if (coachLoading || coachNotConfigured) {
      return;
    }
    const key = String(event?.key || '').toLowerCase();
    const usesMeta = Boolean(event?.metaKey);
    const usesCtrl = Boolean(event?.ctrlKey);
    if (key === 'enter' && (usesMeta || usesCtrl)) {
      event.preventDefault();
      runCustomPromptCoach();
    }
  };

  const copyCoachResponse = async () => {
    if (!coachResponseText) {
      toast.error('No response to copy.');
      return;
    }
    if (!navigator.clipboard?.writeText) {
      toast.error('Clipboard is unavailable in this browser.');
      return;
    }
    try {
      await navigator.clipboard.writeText(coachResponseText);
      setIsCoachResponseCopied(true);
      toast.success('Response copied.');
    } catch {
      toast.error('Could not copy response.');
    }
  };

  const clearCoachResponse = () => {
    setCoachResult(null);
    setCoachResultHash('');
    setCoachCached(false);
    setCoachWithheldCount(0);
    setCoachRequestMeta(null);
    setExpandedSuggestionIds([]);
    setCoachError('');
    setIsCoachResponseCopied(false);
  };

  const openCoachSuggestionReview = (suggestion, suggestionIdOverride = '') => {
    const target = suggestion?.proposed_change?.target === 'doc_a' ? 'a' : 'b';
    const op = String(suggestion?.proposed_change?.op || 'append');
    const nextText = String(suggestion?.proposed_change?.text || '');
    const headingHint = String(suggestion?.proposed_change?.heading_hint || '');
    const requestIntent = String(coachRequestMeta?.intent || '').trim().toLowerCase();
    const isRewriteSelectionIntent = requestIntent === 'rewrite_selection' && op === 'replace_selection';
    const requestSelectionTarget = String(coachRequestMeta?.selectionTarget || '').toLowerCase();
    const requestSelectionSide = requestSelectionTarget === 'confidential' ? 'a' : requestSelectionTarget === 'shared' ? 'b' : null;
    const selectionRangeFromRequest =
      isRewriteSelectionIntent &&
      coachRequestMeta?.selectionRange &&
      requestSelectionSide === target &&
      Number.isFinite(coachRequestMeta.selectionRange.from) &&
      Number.isFinite(coachRequestMeta.selectionRange.to)
        ? {
            from: Number(coachRequestMeta.selectionRange.from),
            to: Number(coachRequestMeta.selectionRange.to),
          }
        : null;
    const selectedText = isRewriteSelectionIntent
      ? String(coachRequestMeta?.selectionText || '').trim()
      : selectionContext.side === target
        ? String(selectionContext.text || '').trim()
        : '';
    const currentText = target === 'a' ? docAText : docBText;
    const updatedText = applySuggestedTextChange({
      currentText,
      op,
      nextText,
      headingHint,
      selectedText,
    });
    const isShared = suggestion?.scope === 'shared' || suggestion?.proposed_change?.target === 'doc_b';
    const diffPreview = isRewriteSelectionIntent
      ? buildWordDiffPreview(selectedText, nextText)
      : buildDiffPreview(currentText, updatedText);
    const jumpText = String(nextText || selectedText || headingHint || '').trim();

    setPendingReviewSuggestion({
      suggestion,
      suggestionId: String(suggestionIdOverride || getNormalizedSuggestionId(suggestion)),
      coachHash: activeCoachHash,
      target,
      op,
      nextText,
      selectedText,
      headingHint,
      currentText,
      updatedText,
      intent: requestIntent,
      selectionRange: selectionRangeFromRequest,
      isShared,
      diffPreview,
      jumpText: jumpText.slice(0, 280),
      changeSummary: isRewriteSelectionIntent
        ? 'This will replace only the selected snippet in the target editor.'
        : getSuggestionChangeSummary(op, headingHint),
    });
  };

  const copyPendingProposedText = async () => {
    if (!pendingReviewSuggestion?.nextText) {
      toast.error('No proposed text to copy.');
      return;
    }
    try {
      await navigator.clipboard.writeText(String(pendingReviewSuggestion.nextText || ''));
      toast.success('Proposed text copied.');
    } catch {
      toast.error('Could not copy proposed text.');
    }
  };

  const markSuggestionApplied = (suggestionIdValue, suggestionHashValue) => {
    const suggestionId = String(suggestionIdValue || '');
    const suggestionHash = String(suggestionHashValue || activeCoachHash || 'unhashed');
    if (!suggestionId) {
      return;
    }
    setAppliedSuggestionIdsByHash((previous) => {
      const current = Array.isArray(previous[suggestionHash]) ? previous[suggestionHash] : [];
      if (current.includes(suggestionId)) {
        return previous;
      }
      return {
        ...previous,
        [suggestionHash]: [...current, suggestionId],
      };
    });
    setExpandedSuggestionIds((previous) => previous.filter((id) => id !== suggestionId));
  };

  const handleReplaceSelectionApplied = (result) => {
    const requestId = Number(result?.id || 0);
    if (!pendingSelectionApply || requestId !== Number(pendingSelectionApply.requestId || 0)) {
      return;
    }
    setReplaceSelectionRequest({ side: null, id: 0, from: 0, to: 0, text: '' });

    if (!result?.success) {
      setIsApplyingReviewSuggestion(false);
      setPendingSelectionApply(null);
      toast.error('Could not apply rewrite to the selected text. Please reselect and try again.');
      return;
    }

    markSuggestionApplied(pendingSelectionApply.suggestionId, pendingSelectionApply.suggestionHash);
    setPendingSelectionApply(null);
    setPendingReviewSuggestion(null);
    updateRouteParams({ nextStep: 2, replace: true });
    setIsApplyingReviewSuggestion(false);
    setFocusEditorRequest({
      side: pendingSelectionApply.target,
      id: Date.now(),
      jumpText: String(result?.text || '').trim().slice(0, 280),
    });
    toast.success('Suggestion applied locally. Click Save Draft to persist.');
  };

  const confirmCoachSuggestionApply = () => {
    if (!pendingReviewSuggestion) {
      return;
    }

    setIsApplyingReviewSuggestion(true);
    const target = pendingReviewSuggestion.target === 'a' ? 'a' : 'b';
    const jumpText = String(pendingReviewSuggestion.jumpText || '').trim();
    const suggestionId = String(pendingReviewSuggestion.suggestionId || '');
    const suggestionHash = String(pendingReviewSuggestion.coachHash || activeCoachHash || 'unhashed');
    const isRewriteSelection = pendingReviewSuggestion.intent === 'rewrite_selection';

    if (isRewriteSelection) {
      const range = pendingReviewSuggestion.selectionRange;
      const nextText = String(pendingReviewSuggestion.nextText || '').trim();
      if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to) || range.to <= range.from) {
        setIsApplyingReviewSuggestion(false);
        toast.error('Selection is no longer available. Re-select text and request rewrite again.');
        return;
      }
      if (!nextText) {
        setIsApplyingReviewSuggestion(false);
        toast.error('No rewritten text returned for this suggestion.');
        return;
      }
      const requestId = Date.now();
      setPendingSelectionApply({
        requestId,
        suggestionId,
        suggestionHash,
        target,
      });
      setReplaceSelectionRequest({
        side: target,
        id: requestId,
        from: Number(range.from),
        to: Number(range.to),
        text: nextText,
      });
      return;
    }

    const updatedText = String(pendingReviewSuggestion.updatedText || '');
    const updatedHtml = sanitizeEditorHtml(textToHtml(updatedText));

    if (target === 'a') {
      latestDraftStateRef.current = {
        ...latestDraftStateRef.current,
        docAText: updatedText,
        docAHtml: updatedHtml,
        docAJson: null,
        docASource: 'typed',
      };
      setDocAText(updatedText);
      setDocAHtml(updatedHtml);
      setDocAJson(null);
      setDocASource('typed');
    } else {
      latestDraftStateRef.current = {
        ...latestDraftStateRef.current,
        docBText: updatedText,
        docBHtml: updatedHtml,
        docBJson: null,
        docBSource: 'typed',
      };
      setDocBText(updatedText);
      setDocBHtml(updatedHtml);
      setDocBJson(null);
      setDocBSource('typed');
    }
    markDraftEdited();

    markSuggestionApplied(suggestionId, suggestionHash);

    setPendingReviewSuggestion(null);
    updateRouteParams({ nextStep: 2, replace: true });
    setFocusEditorRequest({
      side: target,
      id: Date.now(),
      jumpText,
    });
    setIsApplyingReviewSuggestion(false);
    toast.success('Suggestion applied locally. Click Save Draft to persist.');
  };

  const toggleSuggestionExpanded = (suggestionId) => {
    const normalizedId = String(suggestionId || '');
    if (!normalizedId) {
      return;
    }
    setExpandedSuggestionIds((previous) =>
      previous.includes(normalizedId)
        ? previous.filter((id) => id !== normalizedId)
        : [...previous, normalizedId],
    );
  };

  const dismissSuggestion = (suggestionId) => {
    const normalizedId = String(suggestionId || '');
    if (!normalizedId) {
      return;
    }
    const suggestionHash = String(activeCoachHash || 'unhashed');
    setIgnoredSuggestionIdsByHash((previous) => {
      const current = Array.isArray(previous[suggestionHash]) ? previous[suggestionHash] : [];
      if (current.includes(normalizedId)) {
        return previous;
      }
      return {
        ...previous,
        [suggestionHash]: [...current, normalizedId],
      };
    });
    setExpandedSuggestionIds((previous) => previous.filter((id) => id !== normalizedId));
  };

  useEffect(() => {
    if (step !== 2 || !isDirty || saveDraftMutation.isPending || !comparisonId) {
      return undefined;
    }

    const now = Date.now();
    const msSinceLastAutosave = now - lastStep2AutosaveAtRef.current;
    const delayMs =
      msSinceLastAutosave >= STEP2_AUTOSAVE_MIN_INTERVAL_MS
        ? STEP2_AUTOSAVE_DEBOUNCE_MS
        : Math.max(
            STEP2_AUTOSAVE_DEBOUNCE_MS,
            STEP2_AUTOSAVE_MIN_INTERVAL_MS - msSinceLastAutosave,
          );

    const timer = window.setTimeout(() => {
      if (!comparisonIdRef.current || saveMutationPendingRef.current || !isDirtyRef.current) {
        return;
      }
      lastStep2AutosaveAtRef.current = Date.now();
      void bestEffortSaveDraft({
        reason: 'step-2-debounced-autosave',
        stepToSave: 2,
        requireDraftId: true,
      });
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [bestEffortSaveDraft, comparisonId, currentStateHash, isDirty, saveDraftMutation.isPending, step]);

  useEffect(() => () => {
    if (stepRef.current !== 2 || !isDirtyRef.current || !comparisonIdRef.current) {
      return;
    }

    void persistLatestDraftSnapshot({
      reason: 'component-unmount',
      stepToSave: 2,
    });
  }, [persistLatestDraftSnapshot]);

  useEffect(() => {
    const handlePopState = () => {
      if (stepRef.current !== 2 || !isDirtyRef.current || saveDraftMutation.isPending) {
        return;
      }

      void bestEffortSaveDraft({
        reason: 'browser-history-navigation',
        stepToSave: 2,
        requireDraftId: true,
      });
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [bestEffortSaveDraft, saveDraftMutation.isPending]);

  useEffect(() => {
    if (!isDirty) {
      return undefined;
    }

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const renderImportPanel = ({ side, label, selectedFile, setSelectedFile, preview, source, files, fileRef }) => {
    const isImporting = importingSide === side;
    const isAnyImporting = Boolean(importingSide);

    return (
      <Card className="border border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">{label} (Upload/Import)</CardTitle>
          <CardDescription>Upload a DOCX or PDF and import extracted content into this document.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            ref={fileRef}
            type="file"
            accept=".docx,.pdf"
            className="hidden"
            data-testid={`import-file-input-${side}`}
            onChange={(event) => {
              const file = event.target.files?.[0] || null;
              event.target.value = '';
              setSelectedFile(file);
              if (!file) {
                return;
              }
              void importForSide(side, file);
            }}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="w-4 h-4 mr-2" />
              Choose File
            </Button>

            <Button
              type="button"
              onClick={() => importForSide(side)}
              disabled={!selectedFile || isAnyImporting}
              data-testid={`import-button-${side}`}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isImporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
              {isImporting ? 'Importing...' : 'Import'}
            </Button>

            <Badge variant="outline">{source || 'typed'}</Badge>
          </div>

          {selectedFile ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <p className="font-medium break-all">{selectedFile.name}</p>
              <p className="text-xs text-slate-500">{formatFileSize(selectedFile.size)}</p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No file selected.</p>
          )}

          {files.length > 0 ? (
            <p className="text-xs text-slate-500" data-testid={`last-imported-${side}`}>
              Last imported: {files[0]?.filename || 'Unknown file'}
            </p>
          ) : null}

          <div className="space-y-1">
            <Label className="text-sm font-semibold">Preview</Label>
            <div
              className="min-h-[130px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 whitespace-pre-wrap"
              data-testid={`import-preview-${side}`}
            >
              {preview || 'Imported content preview will appear here.'}
            </div>
            {isImporting ? <p className="text-xs text-slate-500">Importing...</p> : null}
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderEditorPanel = (side) => {
    const isA = side === 'a';
    const label = isA ? CONFIDENTIAL_LABEL : SHARED_LABEL;
    const source = isA ? docASource : docBSource;
    const characters = isA ? docACharacters : docBCharacters;
    const words = isA ? docAWords : docBWords;
    const nearLimit = isA ? docANearLimit : docBNearLimit;
    const overLimit = isA ? docAOverLimit : docBOverLimit;
    const limitTextClass = overLimit ? 'text-red-700' : nearLimit ? 'text-amber-700' : 'text-slate-500';

    const panelModeClass =
      fullscreenSide === side
        ? 'fixed inset-5 z-50 bg-white rounded-2xl shadow-2xl border border-slate-300 p-4 overflow-auto'
        : fullscreenSide
          ? 'hidden'
          : 'space-y-3';

    return (
      <div className={panelModeClass}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-700">{label}</h3>
            <Badge variant="outline">{source}</Badge>
          </div>
          <div className={`text-xs ${limitTextClass}`}>
            {characters.toLocaleString()} chars • {words.toLocaleString()} words
          </div>
        </div>

        <DocumentRichEditor
          label={label}
          content={isA ? docAJson || docAHtml : docBJson || docBHtml}
          placeholder={`Edit ${label}...`}
          minHeightClassName={fullscreenSide === side ? 'min-h-[70vh]' : 'min-h-[560px]'}
          scrollContainerClassName={fullscreenSide === side ? 'h-[72vh]' : 'h-[560px]'}
          isFullscreen={fullscreenSide === side}
          maxCharacters={limits.perDocumentCharacterLimit}
          onToggleFullscreen={() => setFullscreenSide((prev) => (prev === side ? null : side))}
          shouldFocus={focusEditorRequest.side === side}
          focusRequestId={focusEditorRequest.side === side ? focusEditorRequest.id : 0}
          jumpToTextRequest={
            focusEditorRequest.side === side && focusEditorRequest.jumpText
              ? { id: focusEditorRequest.id, text: focusEditorRequest.jumpText }
              : null
          }
          replaceSelectionRequest={
            replaceSelectionRequest.side === side && replaceSelectionRequest.id
              ? replaceSelectionRequest
              : null
          }
          onReplaceSelectionApplied={handleReplaceSelectionApplied}
          onSelectionChange={({ text: selectedText, range }) => {
            const normalized = String(selectedText || '').trim();
            setSelectionContext({
              side,
              text: normalized,
              range:
                range && Number.isFinite(range.from) && Number.isFinite(range.to)
                  ? { from: Number(range.from), to: Number(range.to) }
                  : null,
            });
          }}
          data-testid={isA ? 'doc-a-editor' : 'doc-b-editor'}
          editorRef={isA ? docAEditorRef : docBEditorRef}
          onChange={({ html, text, json }) => {
            markDraftEdited();
            if (isA) {
              latestDraftStateRef.current = {
                ...latestDraftStateRef.current,
                docAText: text,
                docAHtml: html,
                docAJson: json,
              };
              setDocAText(text);
              setDocAHtml(html);
              setDocAJson(json);
              return;
            }

            latestDraftStateRef.current = {
              ...latestDraftStateRef.current,
              docBText: text,
              docBHtml: html,
              docBJson: json,
            };
            setDocBText(text);
            setDocBHtml(html);
            setDocBJson(json);
          }}
        />
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 py-6">
      {(isFinishingComparison || isRunningEvaluation) ? (
        <div className="fixed inset-0 z-[70] bg-slate-950/45 backdrop-blur-[1px] flex items-center justify-center">
          <Card className="w-[min(92vw,420px)] border border-slate-300 shadow-xl">
            <CardContent className="py-6 flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900">
                  {finishStage === 'evaluating' ? 'Evaluating...' : 'Saving...'}
                </p>
                <p className="text-xs text-slate-600">
                  {finishStage === 'evaluating'
                    ? 'Running AI evaluation on your latest saved inputs.'
                    : 'Persisting your latest draft before evaluation.'}
                </p>
                {finishStage === 'evaluating' ? (
                  <p className="text-xs text-slate-500">
                    This may take a couple minutes. Please do not exit.
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 xl:px-12">
        <div className="mb-5">
          <Link
            to={createPageUrl('Proposals')}
            className="inline-flex items-center text-slate-600 hover:text-slate-900 mb-2"
            onClick={async (event) => {
              if (step === 2) {
                event.preventDefault();
                if (isDirty) {
                  const shouldLeave = window.confirm('You have unsaved changes. Leave this page?');
                  if (!shouldLeave) {
                    return;
                  }
                }
                await bestEffortSaveDraft({
                  reason: 'back-to-proposals-link',
                  stepToSave: 2,
                  requireDraftId: true,
                });
                navigate(createPageUrl('Proposals'));
                return;
              }

              if (!isDirty) {
                return;
              }
              const shouldLeave = window.confirm('You have unsaved changes. Leave this page?');
              if (!shouldLeave) {
                event.preventDefault();
              }
            }}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Proposals
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">Document Comparison</h1>
          <p className="text-slate-500 mt-1">
            Compare confidential and shared information with a recipient-safe workflow.
          </p>
        </div>

        <div className="mb-5">
          <div className="flex items-center justify-between text-sm mb-3">
            <div className="flex items-center gap-3">
              <span
                className={`font-semibold ${step === 1 ? 'text-blue-600' : 'text-slate-400'}`}
                data-testid="doc-comparison-step-indicator"
              >
                Step {step} of {TOTAL_WORKFLOW_STEPS}
              </span>
              <span className={`text-xs ${saveStatusClassName}`} data-testid="doc-comparison-save-status">
                {saveStatusLabel}
              </span>
            </div>
            <span className="text-slate-500">{Math.round(progress)}% complete</span>
          </div>
          <Progress value={progress} className="h-3" />
        </div>

        {(draftQuery.isLoading || proposalLookup.isLoading) && (
          <Card>
            <CardContent className="py-8 text-slate-500">Loading comparison draft...</CardContent>
          </Card>
        )}

        {uiError && (
          <Alert className="bg-red-50 border-red-200 mb-4">
            <AlertTriangle className="h-4 w-4 text-red-700" />
            <AlertDescription className="text-red-800">{uiError}</AlertDescription>
          </Alert>
        )}

        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div
              key="doc-step-1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
              data-testid="doc-comparison-step-1"
            >
              <Card>
                <CardHeader>
                  <CardTitle>Step 1: Upload and Import</CardTitle>
                  <CardDescription>
                    Upload DOCX or PDF files and import extracted content before editing.
                    {' '}
                    Uploads are optional - you can also type directly in the editor.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="space-y-2 max-w-xl">
                    <Label>Comparison Title</Label>
                    <Input
                      value={title}
                      onChange={(event) => {
                        const nextTitle = event.target.value;
                        latestDraftStateRef.current = {
                          ...latestDraftStateRef.current,
                          title: nextTitle,
                        };
                        setTitle(nextTitle);
                        markDraftEdited();
                      }}
                      placeholder="e.g., Mutual NDA comparison"
                      data-testid="comparison-title-input"
                    />
                    {!asText(title) ? (
                      <p className="text-xs text-slate-500">
                        Optional for now. If left empty, this will save as "Untitled Comparison".
                      </p>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    {renderImportPanel({
                      side: 'a',
                      label: CONFIDENTIAL_LABEL,
                      selectedFile: docASelectedFile,
                      setSelectedFile: setDocASelectedFile,
                      preview: docAPreviewSnippet,
                      source: docASource,
                      files: docAFiles,
                      fileRef: docAInputFileRef,
                    })}

                    {renderImportPanel({
                      side: 'b',
                      label: SHARED_LABEL,
                      selectedFile: docBSelectedFile,
                      setSelectedFile: setDocBSelectedFile,
                      preview: docBPreviewSnippet,
                      source: docBSource,
                      files: docBFiles,
                      fileRef: docBInputFileRef,
                    })}
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => saveDraft(1)}
                  disabled={saveDraftMutation.isPending || exceedsAnySizeLimit}
                  data-testid="step1-save-draft-button"
                >
                  {saveDraftMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-2" />
                  )}
                  {saveDraftMutation.isPending ? 'Saving...' : 'Save Draft'}
                </Button>
                <Button
                  type="button"
                  onClick={() => jumpStep(2)}
                  disabled={saveDraftMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700"
                  data-testid="step1-continue-button"
                >
                  {saveDraftMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      Continue to Editor
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <DocumentComparisonEditorErrorBoundary
              onRetry={retryStep2Load}
              onBackToStep1={() => jumpStep(1)}
            >
              <motion.div
                key="doc-step-2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
                data-testid="doc-comparison-step-2"
              >
                {(docANearLimit || docBNearLimit || totalNearLimit) ? (
                  <Card>
                    <CardContent className="py-4">
                      <Alert className={exceedsAnySizeLimit ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}>
                        <AlertTriangle className={`h-4 w-4 ${exceedsAnySizeLimit ? 'text-red-700' : 'text-amber-700'}`} />
                        <AlertDescription className={exceedsAnySizeLimit ? 'text-red-800' : 'text-amber-800'}>
	                          {exceedsAnySizeLimit
	                            ? 'Editor content is over the safety limit. Reduce text before saving or evaluating.'
	                            : `Approaching the input limit. Keep each document under ${limits.perDocumentCharacterLimit.toLocaleString()} characters.`}
	                        </AlertDescription>
	                      </Alert>
	                    </CardContent>
                  </Card>
                ) : null}

                {canUseOwnerCoach ? (
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
				                                onChange={handleCompanyContextNameChange}
				                                onBlur={handleCompanyContextBlur}
				                              />
				                              <Input
				                                data-testid="company-context-website-input-inline"
				                                placeholder="Website"
				                                value={companyContextWebsite}
				                                onChange={handleCompanyContextWebsiteChange}
				                                onBlur={handleCompanyContextBlur}
				                              />
				                            </div>
				                            {companyContextValidationError ? (
				                              <p
				                                className="text-xs text-red-700"
				                                data-testid="company-context-validation-error"
				                              >
				                                {companyContextValidationError}
				                              </p>
				                            ) : null}
				                            {companyContextSaveError ? (
				                              <div
				                                className="flex items-center gap-2 text-xs text-red-700"
				                                data-testid="company-context-inline-error"
				                              >
				                                <span>{companyContextSaveError}</span>
				                                <button
				                                  type="button"
				                                  className="underline underline-offset-2"
				                                  onClick={retryCompanyContextSave}
				                                  disabled={isSavingCompanyContext}
				                                >
				                                  Retry
				                                </button>
				                              </div>
				                            ) : null}
				                          </div>
				                          <div className="flex flex-wrap gap-2">
				                            {DOCUMENT_COMPARISON_COACH_ACTIONS.map((option) => (
		                              <Button
		                                key={option.id}
		                                type="button"
		                                variant="outline"
		                                size="sm"
		                                disabled={coachLoading || coachNotConfigured}
		                                onClick={() => {
		                                  const request = buildCoachActionRequest(option, selectionContext);
		                                  if (!request) {
		                                    return;
		                                  }
		                                  runCoach(request);
		                                }}
		                              >
		                                {coachLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
			                                {option.label}
			                              </Button>
			                            ))}
			                            <Button
			                              type="button"
			                              variant="outline"
			                              size="sm"
			                              disabled={coachLoading || coachNotConfigured}
			                              onClick={handleCompanyBriefAction}
			                              data-testid="coach-company-brief-action"
			                            >
			                              {coachLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
			                              Company Brief
			                            </Button>
			                          </div>
				                        </div>
				                      </div>
		                      <div
		                        className="h-full rounded-lg border border-slate-200 bg-slate-50/60 p-4 shadow-sm"
		                        data-testid="coach-custom-prompt-panel"
		                      >
		                        <div className="flex h-full flex-col gap-3">
		                          <div className="space-y-1">
		                            <Label htmlFor="coach-custom-prompt-input" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
		                              Custom prompt
		                            </Label>
		                            <p className="text-xs text-slate-500">Ask for feedback, risks, gaps, strategy…</p>
		                          </div>
		                          <Textarea
		                            id="coach-custom-prompt-input"
		                            data-testid="coach-custom-prompt-input"
		                            rows={5}
		                            className="min-h-[140px] w-full resize-y bg-white"
		                            placeholder="Ask for feedback, risks, gaps, strategy…"
		                            value={customPromptText}
		                            onChange={(event) => setCustomPromptText(event.target.value)}
		                            onKeyDown={handleCustomPromptKeyDown}
		                            disabled={coachLoading || coachNotConfigured}
		                          />
		                          <div className="flex justify-end">
		                            <Button
		                              type="button"
		                              data-testid="coach-custom-prompt-run"
		                              onClick={runCustomPromptCoach}
		                              disabled={coachLoading || coachNotConfigured || !asText(customPromptText)}
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
		                            <Button type="button" size="sm" variant="outline" onClick={copyCoachResponse} disabled={!coachResponseText}>
		                              {isCoachResponseCopied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
		                              {isCoachResponseCopied ? 'Copied' : 'Copy'}
		                            </Button>
		                            <Button type="button" size="icon" variant="ghost" aria-label="Clear response" onClick={clearCoachResponse}>
		                              <X className="h-4 w-4" />
		                            </Button>
		                          </div>
		                        </div>
			                        <div className="min-h-[132px] px-4 py-4">
			                          <CoachResponseText text={coachResponseText} />
			                          {coachIntentKey === 'company_brief' && companyBriefSources.length > 0 ? (
			                            <div className="mt-4 border-t border-slate-200 pt-3">
			                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Sources</p>
			                              <ul className="mt-2 space-y-1 text-xs text-slate-600" data-testid="company-brief-sources">
			                                {companyBriefSources.map((source, index) => {
			                                  const title = asText(source?.title) || `Source ${index + 1}`;
			                                  const url = asText(source?.url);
			                                  if (!url) {
			                                    return (
			                                      <li key={`company-brief-source-${index}`}>
			                                        [{index + 1}] {title}
			                                      </li>
			                                    );
			                                  }
			                                  return (
			                                    <li key={`company-brief-source-${index}`}>
			                                      [{index + 1}]{' '}
			                                      <a
			                                        href={url}
			                                        target="_blank"
			                                        rel="noreferrer"
			                                        className="text-blue-700 underline-offset-2 hover:underline"
			                                      >
			                                        {title}
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
                                  <Button type="button" size="sm" onClick={() => openCoachSuggestionReview(suggestion, suggestionId)}>
                                    Review & Apply
                                  </Button>
                                  <Button type="button" size="sm" variant="outline" onClick={() => toggleSuggestionExpanded(suggestionId)}>
                                    {expanded ? 'Hide' : 'Explain'}
                                  </Button>
                                  <Button type="button" size="sm" variant="ghost" onClick={() => dismissSuggestion(suggestionId)}>
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
                ) : null}

                {isStep2LoadingDraft ? (
                  <Card>
                    <CardContent className="py-10 text-slate-500 flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading editor...
                    </CardContent>
                  </Card>
                ) : null}

                {step2LoadError ? (
                  <Card className="border border-amber-200 bg-amber-50">
                    <CardHeader>
                      <CardTitle>We couldn&apos;t load the editor yet.</CardTitle>
                      <CardDescription>
                        Please retry loading this draft, or return to Step 1.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-3">
                      <Button onClick={retryStep2Load}>
                        Retry
                      </Button>
                      <Button variant="outline" onClick={() => jumpStep(1)}>
                        Back to Step 1
                      </Button>
                    </CardContent>
                  </Card>
                ) : null}

                {!isStep2LoadingDraft && !step2LoadError && !comparisonId ? (
                  <Card className="border border-amber-200 bg-amber-50">
                    <CardHeader>
                      <CardTitle>We couldn&apos;t load the editor yet.</CardTitle>
                      <CardDescription>
                        Create the comparison draft first, then continue to editing.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-3">
                      <Button onClick={() => jumpStep(2)} disabled={saveDraftMutation.isPending}>
                        {saveDraftMutation.isPending ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : null}
                        Retry
                      </Button>
                      <Button variant="outline" onClick={() => jumpStep(1)}>
                        Back to Step 1
                      </Button>
                    </CardContent>
                  </Card>
                ) : null}

                {!isStep2LoadingDraft && !step2LoadError && comparisonId ? (
                  <>
                    {fullscreenSide && (
                      <button
                        type="button"
                        aria-label="Close full screen editor"
                        className="fixed inset-0 bg-slate-900/45 z-40"
                        onClick={() => setFullscreenSide(null)}
                      />
                    )}

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
                      {renderEditorPanel('a')}
                      {renderEditorPanel('b')}
                    </div>

                    <div className="flex justify-between pt-2">
                      <Button variant="outline" onClick={() => jumpStep(1)} data-testid="step2-back-button">
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Upload
                      </Button>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleStep2SaveDraftClick}
                          disabled={saveDraftMutation.isPending || exceedsAnySizeLimit}
                          data-testid="step2-save-draft-button"
                        >
                          {saveDraftMutation.isPending ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <Save className="w-4 h-4 mr-2" />
                          )}
                          {saveDraftMutation.isPending ? 'Saving...' : 'Save Draft'}
                        </Button>
                        <Button
                          type="button"
                          onClick={handleFinishClick}
                          disabled={saveDraftMutation.isPending || isFinishingComparison || isRunningEvaluation}
                          className="bg-blue-600 hover:bg-blue-700"
                          data-testid="step2-run-evaluation-button"
                        >
                          {isFinishingComparison ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              {finishStage === 'evaluating' ? 'Evaluating...' : 'Saving...'}
                            </>
                          ) : (
                            <>
                              Run Evaluation
                              <ArrowRight className="w-4 h-4 ml-2" />
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </>
                ) : null}
              </motion.div>
            </DocumentComparisonEditorErrorBoundary>
          )}
	        </AnimatePresence>

	        <Dialog
	          open={showFinishConfirmDialog}
	          onOpenChange={(open) => {
	            if (!isFinishingComparison) {
              setShowFinishConfirmDialog(open);
            }
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Unsaved changes</DialogTitle>
              <DialogDescription>
                Save draft and run evaluation before opening comparison details?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowFinishConfirmDialog(false)}
                disabled={isFinishingComparison || isRunningEvaluation}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => finishToComparisonDetail()}
                disabled={
                  isFinishingComparison ||
                  isRunningEvaluation ||
                  saveDraftMutation.isPending ||
                  exceedsAnySizeLimit
                }
              >
                {isFinishingComparison || isRunningEvaluation || saveDraftMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {finishStage === 'evaluating' ? 'Evaluating...' : 'Saving...'}
                  </>
                ) : (
                  'Save and run evaluation'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={Boolean(pendingReviewSuggestion)}
          onOpenChange={(open) => {
            if (!open) {
              setPendingReviewSuggestion(null);
            }
          }}
        >
          <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Review Suggested Change</DialogTitle>
              <DialogDescription>
                Confirm this suggestion before applying it to{' '}
                {pendingReviewSuggestion?.target === 'a' ? CONFIDENTIAL_LABEL : SHARED_LABEL}.
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
                onClick={copyPendingProposedText}
                disabled={!pendingReviewSuggestion?.nextText}
              >
                Copy proposed text
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPendingReviewSuggestion(null)}
                disabled={isApplyingReviewSuggestion}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={confirmCoachSuggestionApply}
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
      </div>
    </div>
  );
}
