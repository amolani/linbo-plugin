import React from 'react';
import { Clock, Loader2, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { translateError } from '@/lib/errorMessages';
import type { TrackedSession } from '@/stores/operationsTrackerStore';

interface HostSessionRowProps {
  session: TrackedSession;
}

const statusConfig = {
  queued: {
    icon: Clock,
    iconClass: 'text-muted-foreground',
    text: 'Wartend',
  },
  running: {
    icon: Loader2,
    iconClass: 'text-primary animate-spin',
    text: 'Laeuft...',
  },
  success: {
    icon: CheckCircle,
    iconClass: 'text-ciGreen',
    text: 'Fertig',
  },
  failed: {
    icon: XCircle,
    iconClass: 'text-destructive',
    text: '', // will be overridden with translateError
  },
  cancelled: {
    icon: AlertTriangle,
    iconClass: 'text-yellow-400',
    text: 'Abgebrochen',
  },
} as const;

export const HostSessionRow = React.memo(function HostSessionRow({ session }: HostSessionRowProps) {
  const config = statusConfig[session.status] || statusConfig.queued;
  const Icon = config.icon;

  const statusText =
    session.status === 'failed'
      ? translateError(session.error ?? '')
      : config.text;

  return (
    <div className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/30">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className={cn('h-4 w-4 flex-shrink-0', config.iconClass)} />
        <span className="text-sm text-muted-foreground truncate">{statusText}</span>
      </div>
      <span className="font-mono text-sm text-foreground flex-shrink-0 ml-3">
        {session.hostname}
      </span>
    </div>
  );
});
