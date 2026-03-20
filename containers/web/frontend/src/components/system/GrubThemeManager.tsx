import { useState, useEffect, useCallback } from 'react';
import { Save, RotateCcw, Upload, Trash2, Plus, Image as ImageIcon } from 'lucide-react';
import { Button, Input, Modal } from '@/components/ui';
import { systemApi } from '@/api/system';
import type { GrubThemeConfig, GrubThemeStatus, GrubIcon } from '@/types';

type Tab = 'settings' | 'logo' | 'icons';

export function GrubThemeManager() {
  const [tab, setTab] = useState<Tab>('settings');
  const [status, setStatus] = useState<GrubThemeStatus | null>(null);
  const [config, setConfig] = useState<GrubThemeConfig | null>(null);
  const [icons, setIcons] = useState<GrubIcon[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [cacheKey, setCacheKey] = useState(Date.now());

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [statusData, iconsData] = await Promise.all([
        systemApi.getGrubThemeStatus(),
        systemApi.getGrubThemeIcons(),
      ]);
      setStatus(statusData);
      setConfig(statusData.config);
      setIcons(iconsData);
    } catch (err) {
      setError('Fehler beim Laden der Theme-Daten');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const showMessage = (msg: string, isError = false) => {
    if (isError) { setError(msg); setSuccess(null); }
    else { setSuccess(msg); setError(null); }
    setTimeout(() => { setError(null); setSuccess(null); }, 4000);
  };

  const handleSaveConfig = async () => {
    if (!config) return;
    try {
      setSaving(true);
      const updated = await systemApi.updateGrubTheme(config);
      setConfig(updated);
      showMessage('Theme-Einstellungen gespeichert');
    } catch (err) {
      showMessage('Fehler beim Speichern', true);
    } finally {
      setSaving(false);
    }
  };

  const handleResetConfig = async () => {
    if (!confirm('Theme-Einstellungen auf Standard zuruecksetzen?')) return;
    try {
      setSaving(true);
      const reset = await systemApi.resetGrubTheme();
      setConfig(reset);
      showMessage('Theme auf Standard zurueckgesetzt');
    } catch (err) {
      showMessage('Fehler beim Zuruecksetzen', true);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Lade Theme-Daten...</div>;
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'settings', label: 'Einstellungen' },
    { key: 'logo', label: 'Logo' },
    { key: 'icons', label: 'Icons' },
  ];

  return (
    <div className="space-y-6">
      {/* Messages */}
      {error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded-md">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-ciGreen/10 border border-ciGreen/30 text-ciGreen px-4 py-3 rounded-md">
          {success}
        </div>
      )}

      {/* Tabs */}
      <div className="flex space-x-1 bg-secondary rounded-lg p-1">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === t.key
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'settings' && config && (
        <SettingsTab
          config={config}
          onChange={setConfig}
          onSave={handleSaveConfig}
          onReset={handleResetConfig}
          saving={saving}
          cacheKey={cacheKey}
        />
      )}
      {tab === 'logo' && (
        <LogoTab
          status={status}
          cacheKey={cacheKey}
          onUpdate={() => { setCacheKey(Date.now()); fetchData(); }}
          showMessage={showMessage}
        />
      )}
      {tab === 'icons' && (
        <IconsTab
          icons={icons}
          cacheKey={cacheKey}
          onUpdate={() => { setCacheKey(Date.now()); fetchData(); }}
          showMessage={showMessage}
        />
      )}
    </div>
  );
}

// =============================================================================
// Settings Tab
// =============================================================================

function SettingsTab({
  config,
  onChange,
  onSave,
  onReset,
  saving,
  cacheKey,
}: {
  config: GrubThemeConfig;
  onChange: (c: GrubThemeConfig) => void;
  onSave: () => void;
  onReset: () => void;
  saving: boolean;
  cacheKey: number;
}) {
  const updateField = <K extends keyof GrubThemeConfig>(key: K, value: GrubThemeConfig[K]) => {
    onChange({ ...config, [key]: value });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Settings Form */}
      <div className="space-y-6">
        {/* Colors */}
        <div className="bg-card border border-border rounded-lg p-4 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Farben</h3>
          <div className="grid grid-cols-2 gap-4">
            <ColorInput label="Hintergrund" value={config.desktopColor} onChange={v => updateField('desktopColor', v)} />
            <ColorInput label="Menu-Eintrag" value={config.itemColor} onChange={v => updateField('itemColor', v)} />
            <ColorInput label="Ausgewaehlt" value={config.selectedItemColor} onChange={v => updateField('selectedItemColor', v)} />
            <ColorInput label="Countdown" value={config.timeoutColor} onChange={v => updateField('timeoutColor', v)} />
          </div>
        </div>

        {/* Timeout Text */}
        <div className="bg-card border border-border rounded-lg p-4 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Countdown-Text</h3>
          <Input
            value={config.timeoutText}
            onChange={e => updateField('timeoutText', e.target.value)}
            helperText="%d = Countdown-Sekunden"
          />
        </div>

        {/* Sizes */}
        <div className="bg-card border border-border rounded-lg p-4 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Groessen</h3>
          <div className="grid grid-cols-2 gap-4">
            <NumberInput label="Icon-Breite" value={config.iconWidth} onChange={v => updateField('iconWidth', v)} min={16} max={128} />
            <NumberInput label="Icon-Hoehe" value={config.iconHeight} onChange={v => updateField('iconHeight', v)} min={16} max={128} />
            <NumberInput label="Eintrag-Hoehe" value={config.itemHeight} onChange={v => updateField('itemHeight', v)} min={20} max={120} />
            <NumberInput label="Eintrag-Abstand" value={config.itemSpacing} onChange={v => updateField('itemSpacing', v)} min={0} max={60} />
            <NumberInput label="Icon-Abstand" value={config.itemIconSpace} onChange={v => updateField('itemIconSpace', v)} min={0} max={60} />
          </div>
          <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
            <NumberInput label="Logo-Breite" value={config.logoWidth} onChange={v => updateField('logoWidth', v)} min={50} max={1024} />
            <NumberInput label="Logo-Hoehe" value={config.logoHeight} onChange={v => updateField('logoHeight', v)} min={50} max={1024} />
          </div>
        </div>

        {/* Actions */}
        <div className="flex space-x-3">
          <Button onClick={onSave} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'Speichern...' : 'Speichern'}
          </Button>
          <Button variant="secondary" onClick={onReset} disabled={saving}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Standard wiederherstellen
          </Button>
        </div>
      </div>

      {/* Live Preview */}
      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="text-sm font-semibold text-foreground mb-4">Vorschau</h3>
        <div
          className="rounded-lg p-6 relative overflow-hidden"
          style={{ backgroundColor: config.desktopColor, minHeight: 400 }}
        >
          {/* Mock menu entries */}
          <div className="space-y-1" style={{ width: '70%' }}>
            {['LINBO', 'Windows 10 - Start', 'Ubuntu 22.04 - Sync+Start'].map((item, i) => (
              <div
                key={i}
                className="flex items-center px-3 rounded"
                style={{
                  height: config.itemHeight,
                  gap: config.itemIconSpace,
                  backgroundColor: i === 1 ? 'rgba(255,255,255,0.1)' : 'transparent',
                }}
              >
                <div
                  className="rounded bg-white/20 flex-shrink-0"
                  style={{ width: config.iconWidth, height: config.iconHeight }}
                />
                <span style={{
                  color: i === 1 ? config.selectedItemColor : config.itemColor,
                  fontSize: 14,
                }}>
                  {item}
                </span>
              </div>
            ))}
          </div>

          {/* Logo placeholder */}
          <div
            className="absolute bottom-6 right-6 rounded overflow-hidden"
            style={{ width: Math.min(config.logoWidth, 120), height: Math.min(config.logoHeight, 120) }}
          >
            <img
              src={`/api/v1/system/grub-theme/logo?v=${cacheKey}`}
              alt="Logo"
              className="w-full h-full object-contain"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>

          {/* Countdown */}
          <div className="absolute bottom-6 left-6" style={{ color: config.timeoutColor, fontSize: 14 }}>
            {config.timeoutText.replace('%d', '5')}
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Logo Tab
// =============================================================================

function LogoTab({
  status,
  cacheKey,
  onUpdate,
  showMessage,
}: {
  status: GrubThemeStatus | null;
  cacheKey: number;
  onUpdate: () => void;
  showMessage: (msg: string, isError?: boolean) => void;
}) {
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.png')) {
      showMessage('Nur PNG-Dateien erlaubt', true);
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showMessage('Maximale Dateigroesse: 2 MB', true);
      return;
    }
    try {
      setUploading(true);
      await systemApi.uploadGrubThemeLogo(file);
      showMessage('Logo hochgeladen');
      onUpdate();
    } catch {
      showMessage('Fehler beim Hochladen', true);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleReset = async () => {
    if (!confirm('Logo auf Standard zuruecksetzen?')) return;
    try {
      await systemApi.resetGrubThemeLogo();
      showMessage('Logo zurueckgesetzt');
      onUpdate();
    } catch {
      showMessage('Fehler beim Zuruecksetzen', true);
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Logo</h3>
        <span className={`text-xs px-2 py-1 rounded ${
          status?.logo.isCustom ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground'
        }`}>
          {status?.logo.isCustom ? 'Custom' : 'Standard'}
        </span>
      </div>

      <div className="flex items-center space-x-8">
        <div className="w-48 h-48 bg-secondary rounded-lg flex items-center justify-center overflow-hidden">
          <img
            src={`/api/v1/system/grub-theme/logo?v=${cacheKey}`}
            alt="GRUB Logo"
            className="max-w-full max-h-full object-contain"
            onError={e => {
              (e.target as HTMLImageElement).style.display = 'none';
              (e.target as HTMLImageElement).parentElement!.innerHTML = '<span class="text-muted-foreground text-sm">Kein Logo</span>';
            }}
          />
        </div>

        <div className="space-y-4">
          <div>
            <label className="cursor-pointer">
              <input
                type="file"
                accept=".png"
                className="hidden"
                onChange={handleUpload}
                disabled={uploading}
              />
              <span className="inline-flex items-center px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 transition-colors">
                <Upload className="h-4 w-4 mr-2" />
                {uploading ? 'Hochladen...' : 'PNG hochladen'}
              </span>
            </label>
            <p className="text-xs text-muted-foreground mt-2">
              PNG, max. 2 MB, empfohlen 300x300 px
            </p>
          </div>

          {status?.logo.isCustom && (
            <Button variant="secondary" size="sm" onClick={handleReset}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Standard wiederherstellen
            </Button>
          )}

          {status?.logo.size && (
            <p className="text-xs text-muted-foreground">
              Datei: {status.logo.file} ({(status.logo.size / 1024).toFixed(1)} KB)
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Icons Tab
// =============================================================================

function IconsTab({
  icons,
  cacheKey,
  onUpdate,
  showMessage,
}: {
  icons: GrubIcon[];
  cacheKey: number;
  onUpdate: () => void;
  showMessage: (msg: string, isError?: boolean) => void;
}) {
  const [showUpload, setShowUpload] = useState(false);
  const [uploadBaseName, setUploadBaseName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const handleUpload = async () => {
    if (!uploadFile || !uploadBaseName) return;
    const sanitized = uploadBaseName.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!sanitized || sanitized.length > 50) {
      showMessage('Ungueltiger Name (a-z, 0-9, _ und - erlaubt, max. 50 Zeichen)', true);
      return;
    }
    try {
      setUploading(true);
      await systemApi.uploadGrubThemeIcon(uploadFile, sanitized);
      showMessage(`Icon "${sanitized}" hochgeladen (4 Varianten)`);
      setShowUpload(false);
      setUploadBaseName('');
      setUploadFile(null);
      onUpdate();
    } catch {
      showMessage('Fehler beim Hochladen', true);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (baseName: string) => {
    if (!confirm(`Icon "${baseName}" und alle Varianten loeschen?`)) return;
    try {
      await systemApi.deleteGrubThemeIcon(baseName);
      showMessage(`Icon "${baseName}" geloescht`);
      onUpdate();
    } catch {
      showMessage('Fehler beim Loeschen', true);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {icons.length} Icons ({icons.filter(i => i.isCustom).length} custom)
        </p>
        <Button size="sm" onClick={() => setShowUpload(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Icon hochladen
        </Button>
      </div>

      {/* Icon Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {icons.map(icon => (
          <div
            key={icon.baseName}
            className="bg-card border border-border rounded-lg p-3 text-center group relative"
          >
            <div className="w-12 h-12 mx-auto mb-2 flex items-center justify-center">
              <img
                src={`/api/v1/system/grub-theme/icons/${icon.baseName}.png?v=${cacheKey}`}
                alt={icon.baseName}
                className="max-w-full max-h-full object-contain"
                onError={e => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
            <p className="text-xs font-medium text-foreground truncate">{icon.baseName}</p>
            <p className="text-xs text-muted-foreground">
              {icon.variants.length} Dateien
            </p>
            {icon.isCustom && (
              <>
                <span className="text-[10px] text-primary">custom</span>
                <button
                  onClick={() => handleDelete(icon.baseName)}
                  className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive/80 p-1"
                  title="Loeschen"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Upload Modal */}
      <Modal
        isOpen={showUpload}
        onClose={() => { setShowUpload(false); setUploadFile(null); setUploadBaseName(''); }}
        title="Icon hochladen"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            1 PNG hochladen: wird automatisch fuer alle 4 Varianten kopiert
            (base, _start, _syncstart, _newstart)
          </p>

          <Input
            label="Basename"
            value={uploadBaseName}
            onChange={e => setUploadBaseName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
            placeholder="z.B. manjaro"
            helperText="Kleinbuchstaben, Ziffern, _ und - erlaubt"
          />

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">PNG-Datei</label>
            <input
              type="file"
              accept=".png"
              onChange={e => setUploadFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
            />
          </div>

          <div className="flex justify-end space-x-3">
            <Button variant="secondary" onClick={() => setShowUpload(false)}>
              Abbrechen
            </Button>
            <Button
              onClick={handleUpload}
              disabled={!uploadFile || !uploadBaseName || uploading}
            >
              <ImageIcon className="h-4 w-4 mr-2" />
              {uploading ? 'Hochladen...' : 'Hochladen'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// =============================================================================
// Helper Components
// =============================================================================

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      <div className="flex items-center space-x-2">
        <input
          type="color"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-8 h-8 rounded cursor-pointer border border-border"
        />
        <input
          type="text"
          value={value}
          onChange={e => {
            if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) onChange(e.target.value);
          }}
          className="flex-1 px-2 py-1 text-xs font-mono border border-border rounded bg-card text-foreground"
          maxLength={7}
        />
      </div>
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      <input
        type="number"
        value={value}
        onChange={e => {
          const v = parseInt(e.target.value) || 0;
          onChange(Math.max(min, Math.min(max, v)));
        }}
        min={min}
        max={max}
        className="w-full px-2 py-1 text-sm border border-border rounded bg-card text-foreground"
      />
    </div>
  );
}
