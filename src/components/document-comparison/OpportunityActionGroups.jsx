import React from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeActions(actions) {
  if (!Array.isArray(actions)) {
    return [];
  }
  return actions
    .map((action, index) => ({
      key: asText(action?.key) || `action-${index}`,
      label: asText(action?.label),
      onClick: typeof action?.onClick === 'function' ? action.onClick : null,
      disabled: Boolean(action?.disabled),
      loading: Boolean(action?.loading),
      variant: asText(action?.variant) || 'outline',
      className: asText(action?.className),
      icon: action?.icon || null,
    }))
    .filter((action) => action.label && action.onClick);
}

function ActionRow({ actions }) {
  const normalized = normalizeActions(actions);
  if (!normalized.length) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {normalized.map((action) => {
        const Icon = action.icon;
        return (
          <Button
            key={action.key}
            type="button"
            size="sm"
            variant={action.variant}
            className={action.className || undefined}
            onClick={action.onClick}
            disabled={action.disabled || action.loading}
          >
            {action.loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {!action.loading && Icon ? <Icon className="w-4 h-4 mr-2" /> : null}
            {action.label}
          </Button>
        );
      })}
    </div>
  );
}

export default function OpportunityActionGroups({
  className = '',
  downloads = [],
  statusActions = [],
  statusBadge = null,
  statusHelperText = '',
}) {
  const hasDownloads = normalizeActions(downloads).length > 0;
  const hasStatusActions = normalizeActions(statusActions).length > 0;
  const helperText = asText(statusHelperText);
  const hasStatusSection = hasStatusActions || Boolean(statusBadge) || Boolean(helperText);

  if (!hasDownloads && !hasStatusSection) {
    return null;
  }

  return (
    <Card className={`border border-slate-200 shadow-sm ${className}`.trim()}>
      <CardContent className="pt-4 space-y-4">
        {hasDownloads ? (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              Downloads
            </p>
            <ActionRow actions={downloads} />
          </div>
        ) : null}

        {hasStatusSection ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                Status
              </p>
              {statusBadge}
            </div>
            <ActionRow actions={statusActions} />
            {helperText ? (
              <p className="text-xs text-slate-500">{helperText}</p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
