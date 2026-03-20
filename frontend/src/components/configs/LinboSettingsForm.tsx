import { Input, Select } from '@/components/ui';
import type { LinboSettings } from '@/types';

interface LinboSettingsFormProps {
  settings: LinboSettings;
  onChange: (settings: LinboSettings) => void;
  serverIp?: string;
}

const downloadTypeOptions = [
  { value: 'rsync', label: 'Rsync' },
  { value: 'torrent', label: 'Torrent' },
  { value: 'multicast', label: 'Multicast' },
];

const systemTypeOptions = [
  { value: 'bios', label: 'BIOS (32-bit)' },
  { value: 'bios64', label: 'BIOS (64-bit)' },
  { value: 'efi32', label: 'EFI (32-bit)' },
  { value: 'efi64', label: 'EFI (64-bit)' },
];

const localeOptions = [
  { value: 'de-de', label: 'Deutsch (de-de)' },
  { value: 'de-DE', label: 'Deutsch (de-DE)' },
  { value: 'en-gb', label: 'English (en-gb)' },
  { value: 'en-US', label: 'English (en-US)' },
  { value: 'fr-fr', label: 'Francais (fr-fr)' },
  { value: 'es-es', label: 'Espanol (es-es)' },
];

const colorOptions = [
  { value: 'white', label: 'Weiss (white)' },
  { value: 'black', label: 'Schwarz (black)' },
  { value: 'lightgreen', label: 'Hellgruen (lightgreen)' },
  { value: 'green', label: 'Gruen (green)' },
  { value: 'orange', label: 'Orange (orange)' },
  { value: 'red', label: 'Rot (red)' },
  { value: 'yellow', label: 'Gelb (yellow)' },
  { value: 'blue', label: 'Blau (blue)' },
  { value: 'lightblue', label: 'Hellblau (lightblue)' },
  { value: 'gray', label: 'Grau (gray)' },
  { value: 'lightgray', label: 'Hellgrau (lightgray)' },
];

export function LinboSettingsForm({ settings, onChange, serverIp = '10.0.0.1' }: LinboSettingsFormProps) {
  const handleChange = (field: keyof LinboSettings, value: string | number | boolean) => {
    onChange({ ...settings, [field]: value });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="Server"
          value={settings.server || serverIp}
          onChange={(e) => handleChange('server', e.target.value)}
          helperText="IP-Adresse des LINBO-Servers"
        />
        <Input
          label="Cache-Partition"
          value={settings.cache || '/dev/disk0p4'}
          onChange={(e) => handleChange('cache', e.target.value)}
          helperText="z.B. /dev/disk0p4 — disk0 = erste interne Platte (NVMe > SATA > USB)"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="Gruppenname"
          value={settings.group || ''}
          onChange={(e) => handleChange('group', e.target.value)}
          helperText="Name der Hardwaregruppe"
        />
        <Select
          label="Download-Typ"
          value={settings.downloadType || 'rsync'}
          onChange={(e) => handleChange('downloadType', e.target.value as 'rsync' | 'torrent' | 'multicast')}
          options={downloadTypeOptions}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="Root-Timeout (Sek.)"
          type="number"
          value={settings.roottimeout || 600}
          onChange={(e) => handleChange('roottimeout', parseInt(e.target.value) || 600)}
          helperText="Timeout beim Booten"
        />
      </div>

      <div className="border-t pt-4">
        <h4 className="text-sm font-medium text-foreground mb-3">System-Typ & Sprache</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select
            label="System-Typ"
            value={settings.systemtype || 'bios64'}
            onChange={(e) => handleChange('systemtype', e.target.value)}
            options={systemTypeOptions}
          />
          <Select
            label="Locale"
            value={settings.locale || 'de-DE'}
            onChange={(e) => handleChange('locale', e.target.value)}
            options={localeOptions}
          />
        </div>
      </div>

      <div className="border-t pt-4">
        <h4 className="text-sm font-medium text-foreground mb-3">GRUB Boot-Menu</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Boot-Timeout (Sekunden)"
            type="number"
            value={settings.boottimeout ?? 0}
            onChange={(e) => handleChange('boottimeout', parseInt(e.target.value) || 0)}
            helperText="0 = kein Timeout (direkt booten), z.B. 10 = 10 Sek. Countdown"
          />
        </div>
      </div>

      <div className="border-t pt-4">
        <h4 className="text-sm font-medium text-foreground mb-3">Automatische Aktionen</h4>
        <div className="space-y-3">
          <label className="flex items-center">
            <input
              type="checkbox"
              className="rounded border-border text-primary focus:ring-ring mr-2"
              checked={settings.autopartition || false}
              onChange={(e) => handleChange('autopartition', e.target.checked)}
            />
            <span className="text-sm text-foreground">Automatisch partitionieren</span>
          </label>
          <label className="flex items-center">
            <input
              type="checkbox"
              className="rounded border-border text-primary focus:ring-ring mr-2"
              checked={settings.autoformat || false}
              onChange={(e) => handleChange('autoformat', e.target.checked)}
            />
            <span className="text-sm text-foreground">Automatisch formatieren</span>
          </label>
          <label className="flex items-center">
            <input
              type="checkbox"
              className="rounded border-border text-primary focus:ring-ring mr-2"
              checked={settings.autoinitcache || false}
              onChange={(e) => handleChange('autoinitcache', e.target.checked)}
            />
            <span className="text-sm text-foreground">Cache automatisch initialisieren</span>
          </label>
{/* Autostart is per-OS setting, not global LINBO setting */}
        </div>
      </div>

      <div className="border-t pt-4">
        <h4 className="text-sm font-medium text-foreground mb-3">Kernel-Optionen</h4>
        <Input
          label="KernelOptions"
          value={settings.kerneloptions || ''}
          onChange={(e) => handleChange('kerneloptions', e.target.value)}
          placeholder="z.B. quiet splash dhcpretry=9 forcegrub"
          helperText="Kernel-Parameter fuer den LINBO-Boot"
        />
      </div>

      <div className="border-t pt-4">
        <h4 className="text-sm font-medium text-foreground mb-3">Darstellung</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <Input
            label="GUI-Theme"
            value={settings.theme || ''}
            onChange={(e) => handleChange('theme', e.target.value)}
            placeholder="z.B. linbo-modern"
            helperText="Name des LINBO-GUI-Themes (leer = Standard)"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Select
            label="Hintergrund-Schriftfarbe"
            value={settings.backgroundfontcolor || 'white'}
            onChange={(e) => handleChange('backgroundfontcolor', e.target.value)}
            options={colorOptions}
          />
          <Select
            label="Stdout-Farbe"
            value={settings.consolefontcolorsstdout || 'lightgreen'}
            onChange={(e) => handleChange('consolefontcolorsstdout', e.target.value)}
            options={colorOptions}
          />
          <Select
            label="Stderr-Farbe"
            value={settings.consolefontcolorstderr || 'orange'}
            onChange={(e) => handleChange('consolefontcolorstderr', e.target.value)}
            options={colorOptions}
          />
        </div>
        <div className="space-y-3 mt-4">
          <label className="flex items-center">
            <input
              type="checkbox"
              className="rounded border-border text-primary focus:ring-ring mr-2"
              checked={settings.guidisabled || false}
              onChange={(e) => handleChange('guidisabled', e.target.checked)}
            />
            <span className="text-sm text-foreground">GUI deaktivieren (GuiDisabled)</span>
          </label>
          <label className="flex items-center">
            <input
              type="checkbox"
              className="rounded border-border text-primary focus:ring-ring mr-2"
              checked={settings.useminimallayout || false}
              onChange={(e) => handleChange('useminimallayout', e.target.checked)}
            />
            <span className="text-sm text-foreground">Minimales Layout (UseMinimalLayout)</span>
          </label>
          <label className="flex items-center">
            <input
              type="checkbox"
              className="rounded border-border text-primary focus:ring-ring mr-2"
              checked={settings.clientdetailsvisiblebydefault ?? true}
              onChange={(e) => handleChange('clientdetailsvisiblebydefault', e.target.checked)}
            />
            <span className="text-sm text-foreground">Client-Details standardmaessig anzeigen</span>
          </label>
        </div>
      </div>
    </div>
  );
}
