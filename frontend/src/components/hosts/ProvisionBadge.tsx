/**
 * ProvisionBadge - Shows DC provisioning status next to hostname
 *
 * null     → nothing (provisioning not active)
 * pending  → yellow dot + "Queued"
 * running  → blue spinner + "Provisioning..."
 * synced   → green checkmark + "Synced"
 * failed   → red exclamation + "Failed"
 */

interface ProvisionBadgeProps {
  status?: 'pending' | 'running' | 'synced' | 'failed' | null;
  opId?: string | null;
}

export function ProvisionBadge({ status, opId }: ProvisionBadgeProps) {
  if (!status) return null;

  const config: Record<string, { dot: string; text: string; classes: string }> = {
    pending: {
      dot: 'bg-yellow-400',
      text: 'Queued',
      classes: 'text-yellow-400 bg-yellow-600/20 border-yellow-600/30',
    },
    running: {
      dot: 'bg-primary animate-pulse',
      text: 'Provisioning...',
      classes: 'text-primary bg-primary/20 border-primary/30',
    },
    synced: {
      dot: 'bg-ciGreen',
      text: 'Synced',
      classes: 'text-ciGreen bg-ciGreen/20 border-ciGreen/30',
    },
    failed: {
      dot: 'bg-destructive',
      text: 'Failed',
      classes: 'text-destructive bg-destructive/10 border-destructive/30',
    },
  };

  const c = config[status];
  if (!c) return null;

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border ${c.classes}`}
      title={opId ? `Operation: ${opId}` : undefined}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.text}
    </span>
  );
}
