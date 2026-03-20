import { useEffect, useState, useCallback } from 'react';
import {
  Wifi,
  WifiOff,
  Loader2,
  Save,
  Trash2,
  Info,
  Eye,
  EyeOff,
  Pencil,
} from 'lucide-react';
import { systemApi } from '@/api/system';
import { useWsStore } from '@/stores/wsStore';
import type { WlanConfig as WlanConfigType } from '@/types';

export function WlanConfig() {
  const [config, setConfig] = useState<WlanConfigType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [ssid, setSsid] = useState('');
  const [keyMgmt, setKeyMgmt] = useState<'WPA-PSK' | 'NONE'>('WPA-PSK');
  const [psk, setPsk] = useState('');
  const [showPsk, setShowPsk] = useState(false);
  const [editingPsk, setEditingPsk] = useState(false);
  const [scanSsid, setScanSsid] = useState(false);

  const fetchConfig = useCallback(async () => {
    try {
      const data = await systemApi.getWlanConfig();
      setConfig(data);
      setSsid(data.ssid);
      setKeyMgmt(data.keyMgmt);
      setScanSsid(data.scanSsid);
      setPsk('');
      setEditingPsk(!data.enabled);
      setError(null);
    } catch {
      setError('WLAN-Konfiguration konnte nicht geladen werden');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const { subscribe } = useWsStore();
  useEffect(() => {
    const unsub = subscribe('system.wlan_changed', () => fetchConfig());
    return unsub;
  }, [subscribe, fetchConfig]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload: { ssid: string; keyMgmt: string; psk?: string; scanSsid?: boolean } = {
        ssid,
        keyMgmt,
        scanSsid,
      };
      if (keyMgmt === 'WPA-PSK' && editingPsk && psk) {
        payload.psk = psk;
      }
      await systemApi.setWlanConfig(payload);
      setSuccess('WLAN-Konfiguration gespeichert. linbofs64 muss neu gebaut werden.');
      setEditingPsk(false);
      setPsk('');
      fetchConfig();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Speichern fehlgeschlagen';
      setError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisable = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await systemApi.deleteWlanConfig();
      setSuccess('WLAN deaktiviert. linbofs64 muss neu gebaut werden.');
      fetchConfig();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Deaktivieren fehlgeschlagen';
      setError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-card shadow-sm rounded-lg p-6">
        <div className="flex items-center space-x-2">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Lade WLAN-Konfiguration...</span>
        </div>
      </div>
    );
  }

  const isEnabled = config?.enabled ?? false;
  const hasExistingPsk = config?.hasPsk ?? false;

  return (
    <div className="bg-card shadow-sm rounded-lg p-6">
      <div className="flex items-center space-x-3 mb-4">
        <div className={`rounded-md p-2 ${isEnabled ? 'bg-primary' : 'bg-gray-500'}`}>
          {isEnabled ? (
            <Wifi className="h-5 w-5 text-white" />
          ) : (
            <WifiOff className="h-5 w-5 text-white" />
          )}
        </div>
        <div>
          <h3 className="text-lg font-medium text-foreground">WLAN-Konfiguration</h3>
          <span className="text-sm text-muted-foreground">
            {isEnabled ? `Aktiviert (${config?.ssid})` : 'Deaktiviert'}
          </span>
        </div>
      </div>

      {/* Info banner */}
      <div className="mb-4 p-3 bg-primary/10 border border-primary/20 rounded-md">
        <div className="flex items-start space-x-2">
          <Info className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
          <p className="text-sm text-primary">
            Diese Konfiguration gilt nur fuer das LINBO-Client-Netzwerk (PXE-Boot).
            Das installierte Betriebssystem (Windows/Linux) ist davon nicht betroffen.
          </p>
        </div>
      </div>

      {/* Status messages */}
      {error && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-ciGreen/10 border border-ciGreen/20 rounded-md">
          <p className="text-sm text-ciGreen">{success}</p>
        </div>
      )}

      {/* Form */}
      <div className="space-y-4">
        {/* SSID */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">SSID</label>
          <input
            type="text"
            value={ssid}
            onChange={(e) => setSsid(e.target.value)}
            placeholder="Netzwerkname"
            maxLength={32}
            className="w-full px-3 py-2 bg-secondary border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {/* Security */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Sicherheit</label>
          <select
            value={keyMgmt}
            onChange={(e) => setKeyMgmt(e.target.value as 'WPA-PSK' | 'NONE')}
            className="w-full px-3 py-2 bg-secondary border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="WPA-PSK">WPA-PSK</option>
            <option value="NONE">Offen (kein Passwort)</option>
          </select>
        </div>

        {/* Hidden network */}
        <div className="flex items-center space-x-2">
          <input
            type="checkbox"
            id="scanSsid"
            checked={scanSsid}
            onChange={(e) => setScanSsid(e.target.checked)}
            className="h-4 w-4 rounded border-border bg-secondary text-primary focus:ring-primary"
          />
          <label htmlFor="scanSsid" className="text-sm text-foreground">
            Verstecktes Netzwerk (scan_ssid=1)
          </label>
        </div>

        {/* PSK */}
        {keyMgmt === 'WPA-PSK' && (
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Passwort</label>
            {hasExistingPsk && !editingPsk ? (
              <div className="flex items-center space-x-2">
                <div className="flex-1 px-3 py-2 bg-secondary border border-border rounded-md text-sm text-muted-foreground">
                  &#9679;&#9679;&#9679;&#9679;&#9679;&#9679;&#9679;&#9679; konfiguriert
                </div>
                <button
                  onClick={() => setEditingPsk(true)}
                  className="flex items-center space-x-1 px-3 py-2 text-sm bg-primary/10 hover:bg-primary/20 text-primary rounded-md transition-colors"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span>Aendern</span>
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type={showPsk ? 'text' : 'password'}
                  value={psk}
                  onChange={(e) => setPsk(e.target.value)}
                  placeholder="Mindestens 8 Zeichen"
                  className="w-full px-3 py-2 pr-10 bg-secondary border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={() => setShowPsk(!showPsk)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPsk ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          <div>
            {isEnabled && (
              <button
                onClick={handleDisable}
                disabled={isSaving}
                className="flex items-center space-x-1 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 rounded-md transition-colors disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                <span>WLAN deaktivieren</span>
              </button>
            )}
          </div>
          <button
            onClick={handleSave}
            disabled={isSaving || !ssid.trim() || (keyMgmt === 'WPA-PSK' && !hasExistingPsk && !psk)}
            className="flex items-center space-x-1 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            <span>Speichern</span>
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          Nach Aenderungen muss linbofs64 neu gebaut werden.
        </p>
      </div>
    </div>
  );
}
