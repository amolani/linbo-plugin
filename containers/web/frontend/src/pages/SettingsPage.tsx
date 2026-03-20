import { useState, useEffect, useCallback } from 'react';
import { Server, TestTube, X, Eye, EyeOff, Loader2, Check, AlertTriangle } from 'lucide-react';
import { settingsApi, type SettingEntry, type ConnectionTestResult } from '@/api/settings';
import { syncApi } from '@/api/sync';
import { useWsStore } from '@/stores/wsStore';
import { notify } from '@/stores/notificationStore';

function SourceBadge({ source }: { source: string }) {
  const colors: Record<string, string> = {
    redis: 'bg-blue-500/20 text-blue-400',
    env: 'bg-yellow-500/20 text-yellow-400',
    default: 'bg-zinc-500/20 text-zinc-400',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${colors[source] || colors.default}`}>
      {source}
    </span>
  );
}

function SettingRow({
  setting,
  onReset,
  children,
}: {
  setting: SettingEntry;
  onReset: (key: string) => Promise<void>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">{setting.description}</span>
        <SourceBadge source={setting.source} />
      </div>
      <div className="flex items-center gap-2">
        {children}
        {setting.source === 'redis' && (
          <button
            onClick={() => onReset(setting.key)}
            className="p-2 text-muted-foreground hover:text-destructive transition-colors"
            title="Zurücksetzen"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function TextSetting({
  setting,
  onSave,
  onReset,
  type = 'text',
  placeholder,
  disabled,
}: {
  setting: SettingEntry;
  onSave: (key: string, value: string) => Promise<void>;
  onReset: (key: string) => Promise<void>;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(setting.value || '');
  const [saving, setSaving] = useState(false);
  const displayValue = setting.value || '';
  const changed = value !== displayValue;

  useEffect(() => {
    setValue(setting.value || '');
  }, [setting.value]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(setting.key, value);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingRow setting={setting} onReset={onReset}>
      <input
        type={type}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="flex-1 bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
        onKeyDown={(e) => e.key === 'Enter' && changed && !disabled && handleSave()}
      />
      {changed && !disabled && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-2 bg-primary text-primary-foreground text-sm rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Speichern
        </button>
      )}
    </SettingRow>
  );
}

function SecretSetting({
  setting,
  onSave,
  onReset,
  disabled,
}: {
  setting: SettingEntry;
  onSave: (key: string, value: string) => Promise<void>;
  onReset: (key: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [value, setValue] = useState('');
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!value) return;
    setSaving(true);
    try {
      await onSave(setting.key, value);
      setValue('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingRow setting={setting} onReset={onReset}>
      <div className="flex-1 relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={setting.valueMasked || (setting.isSet ? '••••••••' : 'Nicht gesetzt')}
          disabled={disabled}
          className="w-full bg-background border border-border rounded-md px-3 py-2 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
          onKeyDown={(e) => e.key === 'Enter' && value && !disabled && handleSave()}
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {value && !disabled && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-2 bg-primary text-primary-foreground text-sm rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Speichern
        </button>
      )}
    </SettingRow>
  );
}

function PasswordSetting({
  setting,
  onSave,
  onReset,
}: {
  setting: SettingEntry;
  onSave: (key: string, value: string) => Promise<void>;
  onReset: (key: string) => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const canSave = password.length >= 4 && password === confirm;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave('admin_password', password);
      setPassword('');
      setConfirm('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingRow setting={setting} onReset={onReset}>
      <div className="flex-1 flex gap-2">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={setting.isSet ? 'Neues Passwort' : 'Passwort setzen'}
          className="flex-1 bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Bestätigen"
          className="flex-1 bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
      {password && (
        <button
          onClick={handleSave}
          disabled={saving || !canSave}
          className="px-3 py-2 bg-primary text-primary-foreground text-sm rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
          title={!canSave ? 'Passwörter müssen übereinstimmen (min. 4 Zeichen)' : undefined}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Speichern
        </button>
      )}
    </SettingRow>
  );
}

function ToggleSetting({
  setting,
  onSave,
  onReset,
  label,
}: {
  setting: SettingEntry;
  onSave: (key: string, value: string) => Promise<void>;
  onReset: (key: string) => Promise<void>;
  label?: string;
}) {
  const [saving, setSaving] = useState(false);
  const isEnabled = setting.value === 'true';

  const handleToggle = async () => {
    setSaving(true);
    try {
      await onSave(setting.key, isEnabled ? 'false' : 'true');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">{label || setting.description}</span>
        <SourceBadge source={setting.source} />
        {setting.source === 'redis' && (
          <button
            onClick={() => onReset(setting.key)}
            className="p-1 text-muted-foreground hover:text-destructive transition-colors"
            title="Zurücksetzen"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <button
        onClick={handleToggle}
        disabled={saving}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50 ${
          isEnabled ? 'bg-primary' : 'bg-zinc-600'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            isEnabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [connTest, setConnTest] = useState<ConnectionTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [activeMode, setActiveMode] = useState<string | null>(null);
  const { subscribe } = useWsStore();

  const loadSettings = useCallback(async () => {
    try {
      const data = await settingsApi.getAll();
      setSettings(data);
    } catch {
      notify.error('Fehler', 'Settings konnten nicht geladen werden');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMode = useCallback(async () => {
    try {
      const res = await syncApi.getMode();
      setActiveMode(res.mode);
    } catch {}
  }, []);

  useEffect(() => {
    loadSettings();
    loadMode();

    const unsub = subscribe('settings.changed', () => { loadSettings(); });
    return unsub;
  }, [loadSettings, loadMode, subscribe]);

  const handleSave = async (key: string, value: string) => {
    try {
      await settingsApi.set(key, value);
      await loadSettings();
      notify.success('Gespeichert', `${key} wurde aktualisiert`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Fehler beim Speichern';
      notify.error('Fehler', msg);
    }
  };

  const handleReset = async (key: string) => {
    try {
      await settingsApi.reset(key);
      await loadSettings();
      notify.success('Zurückgesetzt', `${key} wurde auf Standard zurückgesetzt`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Fehler beim Zurücksetzen';
      notify.error('Fehler', msg);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setConnTest(null);
    try {
      const result = await settingsApi.testConnection();
      setConnTest(result);
    } catch {
      setConnTest({ reachable: false, healthy: false, latency: 0 });
    } finally {
      setTesting(false);
    }
  };

  const getSetting = (key: string) => settings.find(s => s.key === key);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const syncEnabled = getSetting('sync_enabled');
  const lmnUrl = getSetting('lmn_api_url');
  const lmnUser = getSetting('lmn_api_user');
  const lmnPassword = getSetting('lmn_api_password');
  const lmnSchool = getSetting('lmn_school');
  const serverIp = getSetting('linbo_server_ip');
  const adminPw = getSetting('admin_password_hash');
  const syncInterval = getSetting('sync_interval');

  const isSyncEnabled = syncEnabled?.value === 'true';

  // Check if toggle state differs from active running mode
  const needsRestart = activeMode !== null && (
    (isSyncEnabled && activeMode !== 'sync') ||
    (!isSyncEnabled && activeMode === 'sync')
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Server className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold text-foreground">Server-Einstellungen</h1>
      </div>

      {/* Restart Warning */}
      {needsRestart && (
        <div className="flex items-start gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-yellow-400">Container-Restart erforderlich</p>
            <p className="text-xs text-yellow-400/80 mt-1">
              Der Sync-Modus wurde {isSyncEnabled ? 'aktiviert' : 'deaktiviert'}, aber der API-Container
              läuft noch im <span className="font-mono">{activeMode}</span>-Modus.
              Ein Restart des API-Containers ist nötig, damit die Änderung wirksam wird.
            </p>
            <code className="block mt-2 text-xs text-yellow-400/70 font-mono">
              docker compose up -d --build api
            </code>
          </div>
        </div>
      )}

      {/* Card 1: Authority Server */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Authority Server</h2>

        {/* Sync Mode Toggle */}
        {syncEnabled && (
          <div className="border-b border-border mb-2">
            <ToggleSetting
              setting={syncEnabled}
              onSave={handleSave}
              onReset={handleReset}
              label="Sync-Modus"
            />
            {activeMode && (
              <p className="text-xs text-muted-foreground pb-3 -mt-1">
                Aktueller Modus: <span className={`font-mono ${activeMode === 'sync' ? 'text-green-400' : 'text-zinc-400'}`}>{activeMode}</span>
              </p>
            )}
          </div>
        )}

        <div className={`divide-y divide-border ${!isSyncEnabled ? 'opacity-50' : ''}`}>
          {lmnUrl && (
            <TextSetting
              setting={lmnUrl}
              onSave={handleSave}
              onReset={handleReset}
              placeholder="https://10.0.0.11:8001"
              disabled={!isSyncEnabled}
            />
          )}
          {lmnUser && (
            <TextSetting
              setting={lmnUser}
              onSave={handleSave}
              onReset={handleReset}
              placeholder="global-admin"
              disabled={!isSyncEnabled}
            />
          )}
          {lmnPassword && (
            <SecretSetting
              setting={lmnPassword}
              onSave={handleSave}
              onReset={handleReset}
              disabled={!isSyncEnabled}
            />
          )}
          {lmnSchool && (
            <TextSetting
              setting={lmnSchool}
              onSave={handleSave}
              onReset={handleReset}
              placeholder="default-school"
              disabled={!isSyncEnabled}
            />
          )}
        </div>

        {/* Connection Test */}
        <div className={`mt-4 pt-4 border-t border-border ${!isSyncEnabled ? 'opacity-50' : ''}`}>
          <div className="flex items-center gap-3">
            <button
              onClick={handleTestConnection}
              disabled={testing || !isSyncEnabled}
              className="px-4 py-2 bg-accent text-accent-foreground text-sm rounded-md hover:bg-accent/80 disabled:opacity-50 flex items-center gap-2"
            >
              {testing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <TestTube className="h-4 w-4" />
              )}
              Verbindung testen
            </button>
            {connTest && (
              <div className="flex items-center gap-2 text-sm">
                {connTest.healthy ? (
                  <>
                    <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
                    <span className="text-green-400">
                      Verbunden {connTest.version && `(v${connTest.version})`} — {connTest.latency}ms
                    </span>
                  </>
                ) : connTest.reachable ? (
                  <>
                    <div className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
                    <span className="text-yellow-400">Erreichbar, aber nicht healthy — {connTest.latency}ms</span>
                  </>
                ) : (
                  <>
                    <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
                    <span className="text-red-400">Nicht erreichbar</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Card 2: Netzwerk */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Netzwerk</h2>
        <div className="divide-y divide-border">
          {serverIp && (
            <TextSetting setting={serverIp} onSave={handleSave} onReset={handleReset} placeholder="10.0.0.1" />
          )}
        </div>
      </div>

      {/* Card 3: System */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">System</h2>
        <div className="divide-y divide-border">
          {adminPw && (
            <PasswordSetting setting={adminPw} onSave={handleSave} onReset={handleReset} />
          )}
          {syncInterval && (
            <TextSetting
              setting={syncInterval}
              onSave={handleSave}
              onReset={handleReset}
              type="number"
              placeholder="0 = nur manuell"
              disabled={!isSyncEnabled}
            />
          )}
        </div>
        {syncInterval && (
          <p className="mt-2 text-xs text-muted-foreground">
            Sync-Intervall in Sekunden. 0 = nur manuell synchronisieren.
          </p>
        )}
      </div>
    </div>
  );
}
