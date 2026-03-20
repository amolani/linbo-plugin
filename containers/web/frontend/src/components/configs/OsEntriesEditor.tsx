import { useState, useEffect } from 'react';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { Button, Input, Select, Modal } from '@/components/ui';
import { IconSelect } from './IconSelect';
import { imagesApi } from '@/api/images';
import type { ConfigOs, ConfigPartition, Image } from '@/types';

type OsEntryData = Omit<ConfigOs, 'id' | 'configId'>;

interface OsEntriesEditorProps {
  osEntries: OsEntryData[];
  partitions: Omit<ConfigPartition, 'id' | 'configId'>[];
  onChange: (osEntries: OsEntryData[]) => void;
  iconOptions: Array<{ value: string; label: string }>;
  getIconUrl: (baseName: string, suffix?: string) => string;
}

const defaultOsEntry: OsEntryData = {
  position: 0,
  name: '',
  version: '',
  description: '',
  osType: 'windows',
  iconName: 'win10',
  image: '',
  baseImage: '',
  differentialImage: '',
  rootDevice: '/dev/sda1',
  root: '',
  kernel: 'auto',
  initrd: '',
  append: [],
  startEnabled: true,
  syncEnabled: true,
  newEnabled: true,
  autostart: false,
  autostartTimeout: 5,
  defaultAction: 'sync',
  restoreOpsiState: false,
  forceOpsiSetup: '',
  hidden: false,
};

const osTypeOptions = [
  { value: 'windows', label: 'Windows' },
  { value: 'linux', label: 'Linux' },
  { value: 'other', label: 'Andere' },
];

const defaultActionOptions = [
  { value: 'start', label: 'Starten' },
  { value: 'sync', label: 'Synchronisieren' },
  { value: 'new', label: 'Neu installieren' },
];

export function OsEntriesEditor({ osEntries, partitions, onChange, iconOptions, getIconUrl }: OsEntriesEditorProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [formData, setFormData] = useState<OsEntryData>(defaultOsEntry);
  const [images, setImages] = useState<Image[]>([]);
  const [appendText, setAppendText] = useState('');

  useEffect(() => {
    imagesApi.list().then(setImages).catch(() => {});
  }, []);

  const partitionOptions = partitions.map(p => ({
    value: p.device,
    label: `${p.device} (${p.label || p.fsType || 'unbekannt'})`,
  }));

  const imageOptions = [
    { value: '', label: '-- Kein Image --' },
    ...images
      .filter(img => img.type === 'base' && img.status === 'available')
      .map(img => ({ value: img.filename, label: img.filename })),
  ];

  const diffImageOptions = [
    { value: '', label: '-- Kein Diff-Image --' },
    ...images
      .filter(img => img.type === 'differential' && img.status === 'available')
      .map(img => ({ value: img.filename, label: img.filename })),
  ];

  const handleOsTypeChange = (newOsType: string) => {
    const updates: Partial<OsEntryData> = { osType: newOsType };
    if (newOsType === 'windows') {
      updates.kernel = 'auto';
      updates.initrd = '';
      if (!formData.iconName || formData.iconName === 'linux' || formData.iconName === 'ubuntu') {
        updates.iconName = 'win10';
      }
    } else if (newOsType === 'linux') {
      updates.kernel = 'boot/vmlinuz';
      updates.initrd = 'boot/initrd.img';
      if (!formData.iconName || formData.iconName === 'win' || formData.iconName === 'win10') {
        updates.iconName = 'ubuntu';
      }
    }
    setFormData({ ...formData, ...updates });
  };

  const handleRootDeviceChange = (device: string) => {
    // Sync both Boot (rootDevice) and Root fields
    setFormData({ ...formData, rootDevice: device, root: device });
  };

  const handleOpenModal = (index?: number) => {
    if (index !== undefined) {
      setEditingIndex(index);
      const entry = osEntries[index];
      // Merge with defaults, converting null to undefined for proper fallback
      const cleanEntry: Partial<OsEntryData> = {};
      for (const [key, value] of Object.entries(entry)) {
        (cleanEntry as Record<string, unknown>)[key] = value === null ? undefined : value;
      }
      setFormData({ ...defaultOsEntry, ...cleanEntry });
      // Handle append as string or array
      const appendValue = entry.append;
      if (Array.isArray(appendValue)) {
        setAppendText(appendValue.join('\n'));
      } else if (typeof appendValue === 'string') {
        setAppendText(appendValue);
      } else {
        setAppendText('');
      }
    } else {
      setEditingIndex(null);
      const nextPosition = osEntries.length > 0
        ? Math.max(...osEntries.map(o => o.position)) + 1
        : 1;
      setFormData({ ...defaultOsEntry, position: nextPosition });
      setAppendText('');
    }
    setIsModalOpen(true);
  };

  const handleSave = () => {
    const entryToSave = {
      ...formData,
      append: appendText.split('\n').filter(line => line.trim()),
    };

    if (editingIndex !== null) {
      const updated = [...osEntries];
      updated[editingIndex] = entryToSave;
      onChange(updated);
    } else {
      onChange([...osEntries, entryToSave]);
    }
    setIsModalOpen(false);
  };

  const handleDelete = (index: number) => {
    const updated = osEntries.filter((_, i) => i !== index);
    updated.forEach((o, i) => o.position = i + 1);
    onChange(updated);
  };

  const moveEntry = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= osEntries.length) return;

    const updated = [...osEntries];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    updated.forEach((o, i) => o.position = i + 1);
    onChange(updated);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Definieren Sie die Betriebssysteme mit ihren Boot-Optionen
        </p>
        <Button size="sm" onClick={() => handleOpenModal()}>
          <Plus className="h-4 w-4 mr-1" />
          Betriebssystem hinzufuegen
        </Button>
      </div>

      {osEntries.length === 0 ? (
        <div className="text-center py-8 bg-secondary rounded-lg border-2 border-dashed border-border">
          <p className="text-muted-foreground">Keine Betriebssysteme definiert</p>
          <p className="text-sm text-muted-foreground mt-1">
            Klicken Sie auf "Betriebssystem hinzufuegen" um zu beginnen
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {osEntries.map((entry, index) => (
            <div key={index} className="bg-card border border-border rounded-lg p-4 hover:shadow-sm transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                  <div className="flex flex-col items-center">
                    <span className="text-sm text-muted-foreground">#{entry.position}</span>
                    <div className="flex flex-col">
                      <button
                        onClick={() => moveEntry(index, 'up')}
                        disabled={index === 0}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        <span className="text-xs">&#9650;</span>
                      </button>
                      <button
                        onClick={() => moveEntry(index, 'down')}
                        disabled={index === osEntries.length - 1}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        <span className="text-xs">&#9660;</span>
                      </button>
                    </div>
                  </div>
                  <img
                    src={getIconUrl(entry.iconName || 'unknown')}
                    alt=""
                    className="w-8 h-8 rounded flex-shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <div>
                    <h4 className="font-medium text-foreground">{entry.name || 'Unbenannt'}</h4>
                    <p className="text-sm text-muted-foreground">
                      {osTypeOptions.find(o => o.value === entry.osType)?.label || entry.osType}
                      {entry.baseImage && ` - ${entry.baseImage}`}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Root: {entry.rootDevice}
                      {entry.kernel && ` | Kernel: ${entry.kernel}`}
                      {entry.autostart && ' | Autostart'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  <div className="flex space-x-2 text-xs">
                    {entry.startEnabled && (
                      <span className="px-2 py-1 bg-ciGreen/20 text-ciGreen rounded">Start</span>
                    )}
                    {entry.syncEnabled && (
                      <span className="px-2 py-1 bg-primary/20 text-primary rounded">Sync</span>
                    )}
                    {entry.newEnabled && (
                      <span className="px-2 py-1 bg-yellow-600/20 text-yellow-400 rounded">Neu</span>
                    )}
                  </div>
                  <div className="flex space-x-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleOpenModal(index);
                      }}
                      className="text-primary hover:text-primary/80"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleDelete(index);
                      }}
                      className="text-destructive hover:text-destructive/80"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingIndex !== null ? 'Betriebssystem bearbeiten' : 'Neues Betriebssystem'}
        size="lg"
      >
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Name"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Windows 10, Ubuntu 22.04..."
            />
            <Select
              label="Betriebssystem-Typ"
              value={formData.osType || 'windows'}
              onChange={(e) => handleOsTypeChange(e.target.value)}
              options={osTypeOptions}
            />
          </div>

          <Input
            label="Beschreibung"
            value={formData.description || ''}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Optionale Beschreibung"
          />

          {/* Images */}
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium text-foreground mb-3">Images</h4>
            <div className="grid grid-cols-2 gap-4">
              <Select
                label="Basis-Image"
                value={formData.baseImage || ''}
                onChange={(e) => setFormData({ ...formData, baseImage: e.target.value })}
                options={imageOptions}
              />
              <Select
                label="Differenz-Image (optional)"
                value={formData.differentialImage || ''}
                onChange={(e) => setFormData({ ...formData, differentialImage: e.target.value })}
                options={diffImageOptions}
              />
            </div>
          </div>

          {/* Boot Config */}
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium text-foreground mb-3">Boot-Konfiguration</h4>
            <div className="grid grid-cols-2 gap-4">
              <Select
                label="Root-Partition (Boot + Root)"
                value={formData.rootDevice || ''}
                onChange={(e) => handleRootDeviceChange(e.target.value)}
                options={partitionOptions.length > 0 ? partitionOptions : [{ value: formData.rootDevice || '', label: formData.rootDevice || '(Bitte Partition definieren)' }]}
              />
              <IconSelect
                value={formData.iconName || 'win10'}
                onChange={(v) => setFormData({ ...formData, iconName: v })}
                options={iconOptions}
                getIconUrl={getIconUrl}
                label="Icon"
              />
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <Input
                label="Kernel"
                value={formData.kernel || ''}
                onChange={(e) => setFormData({ ...formData, kernel: e.target.value })}
                placeholder={formData.osType === 'windows' ? 'auto' : 'boot/vmlinuz'}
                helperText={formData.osType === 'windows' ? 'Fuer Windows: "auto"' : 'Pfad zum Kernel relativ zur Root-Partition'}
              />
              <Input
                label="Initrd"
                value={formData.initrd || ''}
                onChange={(e) => setFormData({ ...formData, initrd: e.target.value })}
                placeholder={formData.osType === 'linux' ? 'boot/initrd.img' : ''}
                helperText={formData.osType === 'windows' ? 'Fuer Windows leer lassen' : 'Pfad zur initrd relativ zur Root-Partition'}
              />
            </div>
          </div>

          {/* Boot Options */}
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium text-foreground mb-3">Aktionen aktivieren</h4>
            <div className="grid grid-cols-3 gap-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  className="rounded border-border text-primary focus:ring-ring mr-2"
                  checked={formData.startEnabled}
                  onChange={(e) => setFormData({ ...formData, startEnabled: e.target.checked })}
                />
                <span className="text-sm text-foreground">Starten</span>
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  className="rounded border-border text-primary focus:ring-ring mr-2"
                  checked={formData.syncEnabled}
                  onChange={(e) => setFormData({ ...formData, syncEnabled: e.target.checked })}
                />
                <span className="text-sm text-foreground">Synchronisieren</span>
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  className="rounded border-border text-primary focus:ring-ring mr-2"
                  checked={formData.newEnabled}
                  onChange={(e) => setFormData({ ...formData, newEnabled: e.target.checked })}
                />
                <span className="text-sm text-foreground">Neu installieren</span>
              </label>
            </div>
          </div>

          {/* Autostart & Visibility */}
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium text-foreground mb-3">Autostart & Sichtbarkeit</h4>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  className="rounded border-border text-primary focus:ring-ring mr-2"
                  checked={formData.autostart}
                  onChange={(e) => setFormData({ ...formData, autostart: e.target.checked })}
                />
                <span className="text-sm text-foreground">Autostart aktivieren</span>
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  className="rounded border-border text-primary focus:ring-ring mr-2"
                  checked={formData.hidden || false}
                  onChange={(e) => setFormData({ ...formData, hidden: e.target.checked })}
                />
                <span className="text-sm text-foreground">In LINBO GUI verstecken</span>
              </label>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Input
                label="Timeout (Sek.)"
                type="number"
                value={formData.autostartTimeout}
                onChange={(e) => setFormData({ ...formData, autostartTimeout: parseInt(e.target.value) || 0 })}
                disabled={!formData.autostart}
              />
              <Select
                label="Standard-Aktion"
                value={formData.defaultAction || 'sync'}
                onChange={(e) => setFormData({ ...formData, defaultAction: e.target.value })}
                options={defaultActionOptions}
              />
              <Input
                label="Version (optional)"
                value={formData.version || ''}
                onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                placeholder="z.B. 22H2"
              />
            </div>
          </div>

          {/* Append - always visible */}
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium text-foreground mb-3">Kernel-Parameter (Append)</h4>
            <textarea
              className="w-full px-3 py-2 border border-border rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring sm:text-sm font-mono bg-card text-foreground"
              rows={3}
              value={appendText}
              onChange={(e) => setAppendText(e.target.value)}
              placeholder={formData.osType === 'linux' ? 'quiet splash\nroot=/dev/sda2' : 'Optional fuer Windows'}
            />
            <p className="text-xs text-muted-foreground mt-1">Ein Parameter pro Zeile</p>
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t">
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
