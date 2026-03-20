import { Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useOperationsTrackerStore } from '@/stores/operationsTrackerStore';

interface OperationsButtonProps {
  collapsed: boolean;
}

export function OperationsButton({ collapsed }: OperationsButtonProps) {
  const activeCount = useOperationsTrackerStore((s) => s.activeCount);
  const openPanel = useOperationsTrackerStore((s) => s.openPanel);

  return (
    <button
      onClick={openPanel}
      className={cn(
        'flex items-center w-full px-3 py-2 text-sm font-medium rounded-md transition-colors',
        activeCount > 0
          ? 'text-primary hover:bg-primary/10'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        collapsed ? 'justify-center' : ''
      )}
      title={collapsed ? 'Operationen' : undefined}
    >
      <span className="relative flex-shrink-0">
        <Activity className="h-4 w-4" />
        {activeCount > 0 && (
          <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-[10px] text-primary-foreground flex items-center justify-center">
            {activeCount}
          </span>
        )}
      </span>
      {!collapsed && <span className="ml-3">Operationen</span>}
    </button>
  );
}
