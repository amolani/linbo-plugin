import type { ConfigPartition } from '@/types';

type PartitionData = Omit<ConfigPartition, 'id' | 'configId'>;

interface DiskLayoutBarProps {
  partitions: PartitionData[];
}

const FS_COLORS: Record<string, string> = {
  ntfs: '#3b82f6',
  ext4: '#22c55e',
  ext3: '#16a34a',
  btrfs: '#84cc16',
  xfs: '#a3e635',
  vfat: '#ef4444',
  swap: '#eab308',
  cache: '#22c55e',
  '': '#6b7280',
};

function parseSize(size: string): number | null {
  if (!size || !size.trim()) return null;
  const match = size.trim().match(/^(\d+(?:\.\d+)?)\s*([TGMK]?)$/i);
  if (!match) return null;
  const num = parseFloat(match[1]);
  const unit = (match[2] || 'M').toUpperCase();
  switch (unit) {
    case 'T': return num * 1000000;
    case 'G': return num * 1000;
    case 'M': return num;
    case 'K': return num / 1000;
    default: return null;
  }
}

function getSegmentLabel(p: PartitionData): string {
  if (p.label) return p.label;
  if ((p.fsType === '' || !p.fsType) && p.partitionId === '0c01') return 'MSR';
  if ((p.fsType === '' || !p.fsType) && p.partitionId === 'ef') return 'EFI';
  if (!p.fsType || p.fsType === '') return 'Unformatiert';
  return p.fsType.toUpperCase();
}

function getSegmentColor(fsType: string): string {
  return FS_COLORS[fsType || ''] || '#9ca3af';
}

export function DiskLayoutBar({ partitions }: DiskLayoutBarProps) {
  if (partitions.length === 0) return null;

  const parsed = partitions.map(p => ({
    ...p,
    parsedSize: parseSize(p.size || ''),
    label: getSegmentLabel(p),
    color: getSegmentColor(p.fsType || ''),
  }));

  const totalFixed = parsed.reduce((sum, p) => sum + (p.parsedSize || 0), 0);
  const restCount = parsed.filter(p => p.parsedSize === null).length;
  // Give "rest" partitions a reasonable visual share
  const restSize = restCount > 0 ? Math.max(totalFixed * 0.3, 20000) / restCount : 0;
  const totalSize = totalFixed + restSize * restCount;

  const segments = parsed.map(p => {
    const size = p.parsedSize ?? restSize;
    const pct = Math.max((size / totalSize) * 100, 5);
    return { ...p, pct, displaySize: p.size || 'Rest' };
  });

  // Normalize percentages to sum to 100
  const totalPct = segments.reduce((s, seg) => s + seg.pct, 0);
  const normalized = segments.map(seg => ({ ...seg, pct: (seg.pct / totalPct) * 100 }));

  return (
    <div className="mb-4">
      <div className="flex h-10 rounded-lg overflow-hidden gap-0.5 bg-muted">
        {normalized.map((seg, i) => (
          <div
            key={i}
            style={{ width: `${seg.pct}%`, backgroundColor: seg.color }}
            className="flex items-center justify-center overflow-hidden transition-all"
            title={`${seg.label} — ${seg.displaySize} — ${seg.fsType || 'unformatiert'}`}
          >
            {seg.pct > 8 && (
              <span className="text-xs font-medium text-white truncate px-1">
                {seg.label}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="flex mt-1">
        {normalized.map((seg, i) => (
          <div key={i} style={{ width: `${seg.pct}%` }} className="text-center">
            <span className="text-[10px] text-muted-foreground truncate block px-0.5">
              {seg.displaySize}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
