import { useState } from 'react';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { Button, Input, Select, Modal } from '@/components/ui';
import { DiskLayoutBar } from './DiskLayoutBar';
import type { ConfigPartition } from '@/types';

type PartitionData = Omit<ConfigPartition, 'id' | 'configId'>;

interface PartitionsEditorProps {
  partitions: PartitionData[];
  onChange: (partitions: PartitionData[]) => void;
}

const defaultPartition: PartitionData = {
  position: 0,
  device: '/dev/disk0p1',
  label: '',
  size: '',
  partitionId: '',
  fsType: 'ntfs',
  bootable: false,
};

const fsTypeOptions = [
  { value: 'ntfs', label: 'NTFS (Windows)' },
  { value: 'ext4', label: 'ext4 (Linux)' },
  { value: 'ext3', label: 'ext3 (Linux)' },
  { value: 'xfs', label: 'XFS' },
  { value: 'btrfs', label: 'Btrfs' },
  { value: 'vfat', label: 'FAT32 (EFI)' },
  { value: 'swap', label: 'Swap' },
  { value: 'cache', label: 'LINBO Cache' },
  { value: '', label: 'Unformatiert' },
];

// Auto-suggest partition ID based on fsType
const fsTypeToIdMap: Record<string, string> = {
  vfat: 'ef',
  ntfs: '7',
  ext4: '83',
  ext3: '83',
  xfs: '83',
  btrfs: '83',
  swap: '82',
  cache: '83',
};

export function PartitionsEditor({ partitions, onChange }: PartitionsEditorProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [formData, setFormData] = useState<PartitionData>(defaultPartition);
  // Track auto-suggested ID to know when to overwrite
  const [autoSuggestedId, setAutoSuggestedId] = useState<string>('');

  const handleOpenModal = (index?: number) => {
    if (index !== undefined) {
      setEditingIndex(index);
      setFormData(partitions[index]);
      setAutoSuggestedId('');
    } else {
      setEditingIndex(null);
      const nextPosition = partitions.length > 0
        ? Math.max(...partitions.map(p => p.position)) + 1
        : 1;
      const nextPartNum = partitions.length + 1;
      const newData = {
        ...defaultPartition,
        position: nextPosition,
        device: `/dev/disk0p${nextPartNum}`,
      };
      setFormData(newData);
      setAutoSuggestedId('');
    }
    setIsModalOpen(true);
  };

  const handleFsTypeChange = (newFsType: string) => {
    const suggestedId = fsTypeToIdMap[newFsType] || '';
    const currentId = formData.partitionId || '';
    // Auto-suggest if field is empty or still matches previous auto-suggest
    const shouldAutoFill = !currentId || currentId === autoSuggestedId;
    setAutoSuggestedId(suggestedId);
    setFormData({
      ...formData,
      fsType: newFsType,
      ...(shouldAutoFill ? { partitionId: suggestedId } : {}),
    });
  };

  const handleSave = () => {
    if (editingIndex !== null) {
      const updated = [...partitions];
      updated[editingIndex] = formData;
      onChange(updated);
    } else {
      onChange([...partitions, formData]);
    }
    setIsModalOpen(false);
  };

  const handleDelete = (index: number) => {
    const updated = partitions.filter((_, i) => i !== index);
    // Reposition
    updated.forEach((p, i) => p.position = i + 1);
    onChange(updated);
  };

  const movePartition = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= partitions.length) return;

    const updated = [...partitions];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    updated.forEach((p, i) => p.position = i + 1);
    onChange(updated);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Definieren Sie die Partitionsstruktur der Festplatte
        </p>
        <Button size="sm" onClick={() => handleOpenModal()}>
          <Plus className="h-4 w-4 mr-1" />
          Partition hinzufuegen
        </Button>
      </div>

      {partitions.length > 0 && <DiskLayoutBar partitions={partitions} />}

      {partitions.length === 0 ? (
        <div className="text-center py-8 bg-secondary rounded-lg border-2 border-dashed border-border">
          <p className="text-muted-foreground">Keine Partitionen definiert</p>
          <p className="text-sm text-muted-foreground mt-1">
            Klicken Sie auf "Partition hinzufuegen" um zu beginnen
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-secondary">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">#</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Device</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Label</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Groesse</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Dateisystem</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Bootable</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Aktionen</th>
              </tr>
            </thead>
            <tbody className="bg-card divide-y divide-border">
              {partitions.map((partition, index) => (
                <tr key={index} className="hover:bg-muted/50">
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    <div className="flex items-center space-x-1">
                      <span>{partition.position}</span>
                      <div className="flex flex-col">
                        <button
                          type="button"
                          onClick={() => movePartition(index, 'up')}
                          disabled={index === 0}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                        >
                          <span className="text-xs">&#9650;</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => movePartition(index, 'down')}
                          disabled={index === partitions.length - 1}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                        >
                          <span className="text-xs">&#9660;</span>
                        </button>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm font-mono text-foreground">{partition.device}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{partition.label || '-'}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{partition.size || 'Rest'}</td>
                  <td className="px-4 py-3 text-sm font-mono text-muted-foreground">{partition.partitionId || '-'}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {fsTypeOptions.find(o => o.value === partition.fsType)?.label || partition.fsType || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {partition.bootable ? (
                      <span className="text-ciGreen">Ja</span>
                    ) : (
                      <span className="text-muted-foreground">Nein</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex space-x-2">
                      <button
                        type="button"
                        onClick={() => handleOpenModal(index)}
                        className="text-primary hover:text-primary/80"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(index)}
                        className="text-destructive hover:text-destructive/80"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingIndex !== null ? 'Partition bearbeiten' : 'Neue Partition'}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Device"
              value={formData.device}
              onChange={(e) => setFormData({ ...formData, device: e.target.value })}
              placeholder="/dev/disk0p1"
              helperText="z.B. /dev/disk0p1 (universal für SATA + NVMe)"
            />
            <Input
              label="Label"
              value={formData.label || ''}
              onChange={(e) => setFormData({ ...formData, label: e.target.value })}
              placeholder="Windows, Linux, Cache..."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Groesse"
              value={formData.size || ''}
              onChange={(e) => setFormData({ ...formData, size: e.target.value })}
              placeholder="100G, 50%, oder leer fuer Rest"
              helperText="Leer lassen fuer restlichen Speicherplatz"
            />
            <Select
              label="Dateisystem"
              value={formData.fsType || ''}
              onChange={(e) => handleFsTypeChange(e.target.value)}
              options={fsTypeOptions}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Partitions-ID (hex)"
              value={formData.partitionId || ''}
              onChange={(e) => {
                setAutoSuggestedId('');
                setFormData({ ...formData, partitionId: e.target.value.replace(/^0x/i, '').toLowerCase() });
              }}
              placeholder="z.B. 83, ef, 0c01, 7"
              helperText="Hex-Wert wie in start.conf (ef=EFI, 7=NTFS, 83=Linux, 82=Swap, 0c01=MSR)"
            />
            <div className="flex items-end">
              <label className="flex items-center pb-1">
                <input
                  type="checkbox"
                  className="rounded border-border text-primary focus:ring-ring mr-2"
                  checked={formData.bootable}
                  onChange={(e) => setFormData({ ...formData, bootable: e.target.checked })}
                />
                <span className="text-sm text-foreground">Bootable (aktive Partition)</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleSave}>
              {editingIndex !== null ? 'Speichern' : 'Hinzufuegen'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
