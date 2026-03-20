import { useState } from 'react';
import {
  Package,
  Upload,
  HardDrive,
  UserPlus,
  Terminal,
  RefreshCw,
  Settings,
  Power,
  LogOut,
  Play,
  Database,
} from 'lucide-react';
import type { ConfigOs, LinboSettings } from '@/types';

type OsEntryData = Omit<ConfigOs, 'id' | 'configId'>;

interface LinboGuiAdminPreviewProps {
  osEntries: OsEntryData[];
  linboSettings: LinboSettings;
  getIconUrl: (baseName: string) => string;
}

const LOCALE_LABELS: Record<string, Record<string, string>> = {
  'de-de': {
    adminTitle: 'Imaging',
    createImage: 'Image erstellen',
    uploadImage: 'Image hochladen',
    partition: 'Partitionieren',
    register: 'Registrieren',
    console: 'Konsole',
    updateCache: 'Cache aktualisieren',
    systemTools: 'System-Werkzeuge',
    baseImage: 'Basisimage',
    diffImage: 'Diff-Image',
    noImage: 'Kein Image',
    noOs: 'Keine Betriebssysteme konfiguriert',
    logout: 'Abmelden',
    by: 'von',
    size: 'Groesse',
    date: 'Datum',
  },
  'en-gb': {
    adminTitle: 'Imaging',
    createImage: 'Create image',
    uploadImage: 'Upload image',
    partition: 'Partition',
    register: 'Register',
    console: 'Console',
    updateCache: 'Update cache',
    systemTools: 'System tools',
    baseImage: 'Base image',
    diffImage: 'Diff image',
    noImage: 'No image',
    noOs: 'No operating systems configured',
    logout: 'Log out',
    by: 'by',
    size: 'Size',
    date: 'Date',
  },
};

function getLabels(locale?: string): Record<string, string> {
  if (!locale) return LOCALE_LABELS['de-de'];
  const key = locale.toLowerCase();
  return LOCALE_LABELS[key] || LOCALE_LABELS['de-de'];
}

const FALLBACK_ICON = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">' +
  '<rect width="64" height="64" rx="12" fill="#374151"/>' +
  '<text x="32" y="38" text-anchor="middle" font-size="24" fill="#9CA3AF">?</text>' +
  '</svg>'
);

export function LinboGuiAdminPreview({ osEntries, linboSettings, getIconUrl }: LinboGuiAdminPreviewProps) {
  const labels = getLabels(linboSettings.locale);
  const visibleOs = osEntries.filter(os => !os.hidden);

  return (
    <div
      className="relative rounded-xl overflow-hidden select-none"
      style={{
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
        aspectRatio: '16 / 10',
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      }}
    >
      {/* Subtle mesh overlay */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: 'radial-gradient(circle at 30% 70%, rgba(139,92,246,0.3) 0%, transparent 50%), radial-gradient(circle at 70% 30%, rgba(59,130,246,0.3) 0%, transparent 50%)',
        }}
      />

      {/* Content container */}
      <div className="relative z-10 flex flex-col h-full p-4 sm:p-6">
        {/* Header */}
        <div className="text-center mb-3 flex-shrink-0">
          <h1
            className="text-xl sm:text-2xl font-bold tracking-[0.3em] text-white/90"
            style={{ textShadow: '0 2px 8px rgba(0,0,0,0.3)' }}
          >
            LINBO
          </h1>
          <div className="text-[9px] sm:text-[10px] text-violet-300/60 tracking-wider mt-0.5 font-medium">
            {labels.adminTitle}
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 sm:space-y-3">
          {/* OS Imaging Cards */}
          {visibleOs.length === 0 ? (
            <EmptyState label={labels.noOs} />
          ) : (
            visibleOs.map((os, i) => (
              <OsImagingCard
                key={i}
                os={os}
                getIconUrl={getIconUrl}
                labels={labels}
              />
            ))
          )}

          {/* System Tools Card */}
          <SystemToolsCard labels={labels} />
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 mt-2 sm:mt-3">
          <div className="flex items-center justify-between text-[8px] sm:text-[9px] text-white/30">
            <span>LINBO 4.3 &middot; {linboSettings.server || '10.0.0.1'}</span>
            <div className="flex items-center gap-2">
              <button className="text-white/30 hover:text-white/60 transition-colors flex items-center gap-1" title={labels.logout}>
                <LogOut className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              </button>
              <button className="text-white/30 hover:text-white/60 transition-colors" title="Settings">
                <Settings className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              </button>
              <button className="text-white/30 hover:text-white/60 transition-colors" title="Power">
                <Power className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Sub-components ----------

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-8">
      <div className="text-center">
        <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-2">
          <Play className="w-5 h-5 text-white/20" />
        </div>
        <p className="text-xs text-white/30">{label}</p>
      </div>
    </div>
  );
}

interface OsImagingCardProps {
  os: OsEntryData;
  getIconUrl: (baseName: string) => string;
  labels: Record<string, string>;
}

function OsImagingCard({ os, getIconUrl, labels }: OsImagingCardProps) {
  const [imgError, setImgError] = useState(false);
  const iconName = os.iconName || 'unknown';
  const iconSrc = imgError ? FALLBACK_ICON : getIconUrl(iconName);
  const baseImage = os.baseImage || labels.noImage;
  const diffImage = os.differentialImage || null;

  return (
    <div
      className="rounded-lg border border-white/10 backdrop-blur-md transition-all duration-200 hover:border-white/20 hover:bg-white/[0.08]"
      style={{
        background: 'rgba(255,255,255,0.05)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.05)',
      }}
    >
      {/* OS Header */}
      <div className="flex items-center p-2.5 sm:p-3">
        <div className="flex-shrink-0 w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-white/5 flex items-center justify-center mr-2.5 sm:mr-3">
          <img
            src={iconSrc}
            alt={os.name}
            className="w-6 h-6 sm:w-7 sm:h-7 object-contain"
            onError={() => setImgError(true)}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs sm:text-sm font-semibold text-white truncate">
            {os.name || 'Unbenannt'}
          </div>
          <div className="text-[8px] sm:text-[9px] text-white/40 truncate flex items-center gap-2">
            <span>
              <Database className="w-2.5 h-2.5 inline mr-0.5" />
              {baseImage}
            </span>
            {diffImage && (
              <span className="text-violet-300/50">+ {diffImage}</span>
            )}
          </div>
        </div>
      </div>

      {/* Image info row */}
      <div className="px-2.5 sm:px-3 pb-1">
        <div className="flex gap-3 text-[7px] sm:text-[8px] text-white/25">
          <span>{labels.size}: ---</span>
          <span>{labels.date}: ---</span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-1.5 px-2.5 sm:px-3 pb-2.5 sm:pb-3 pt-1">
        <AdminButton
          icon={<Package className="w-2.5 h-2.5 sm:w-3 sm:h-3" />}
          label={labels.createImage}
          color="#7c3aed"
        />
        <AdminButton
          icon={<Upload className="w-2.5 h-2.5 sm:w-3 sm:h-3" />}
          label={labels.uploadImage}
          color="#2563eb"
        />
      </div>
    </div>
  );
}

function SystemToolsCard({ labels }: { labels: Record<string, string> }) {
  return (
    <div
      className="rounded-lg border border-white/10 backdrop-blur-md"
      style={{
        background: 'rgba(255,255,255,0.03)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.03)',
      }}
    >
      <div className="px-2.5 sm:px-3 pt-2 pb-1">
        <div className="text-[8px] sm:text-[9px] font-semibold text-white/30 uppercase tracking-wider">
          {labels.systemTools}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5 px-2.5 sm:px-3 pb-2.5 sm:pb-3 pt-1">
        <AdminButton
          icon={<HardDrive className="w-2.5 h-2.5 sm:w-3 sm:h-3" />}
          label={labels.partition}
          color="#dc2626"
          wide
        />
        <AdminButton
          icon={<UserPlus className="w-2.5 h-2.5 sm:w-3 sm:h-3" />}
          label={labels.register}
          color="#0891b2"
          wide
        />
        <AdminButton
          icon={<Terminal className="w-2.5 h-2.5 sm:w-3 sm:h-3" />}
          label={labels.console}
          color="#475569"
          wide
        />
        <AdminButton
          icon={<RefreshCw className="w-2.5 h-2.5 sm:w-3 sm:h-3" />}
          label={labels.updateCache}
          color="#059669"
          wide
        />
      </div>
    </div>
  );
}

interface AdminButtonProps {
  icon: React.ReactNode;
  label: string;
  color: string;
  wide?: boolean;
}

function AdminButton({ icon, label, color, wide }: AdminButtonProps) {
  return (
    <button
      type="button"
      className={`
        flex items-center gap-1 rounded-full px-2 sm:px-2.5 py-1 sm:py-1.5
        text-[8px] sm:text-[9px] font-medium text-white
        transition-all duration-150 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]
        ${wide ? 'justify-center w-full' : ''}
      `}
      style={{
        backgroundColor: color,
        boxShadow: `0 2px 8px ${color}40`,
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
