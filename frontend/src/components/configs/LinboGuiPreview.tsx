import { useState } from 'react';
import { RefreshCw, Play, RotateCcw, Settings, Power } from 'lucide-react';
import type { ConfigOs, LinboSettings } from '@/types';

type OsEntryData = Omit<ConfigOs, 'id' | 'configId'>;

interface LinboGuiPreviewProps {
  osEntries: OsEntryData[];
  linboSettings: LinboSettings;
  getIconUrl: (baseName: string) => string;
}

// Locale label maps — DE + EN for Phase A
const LOCALE_LABELS: Record<string, Record<string, string>> = {
  'de-de': {
    hostname: 'Hostname',
    group: 'Host-Gruppe',
    ip: 'IP-Adresse',
    hdd: 'Festplatte',
    cache: 'Cache',
    ram: 'RAM',
    syncStart: 'Sync+Start',
    start: 'Start',
    newStart: 'Neu+Start',
    guiDisabled: 'GUI Deaktiviert',
    noOs: 'Keine Betriebssysteme konfiguriert',
    by: 'von',
  },
  'en-gb': {
    hostname: 'Hostname',
    group: 'Host group',
    ip: 'IP address',
    hdd: 'HDD',
    cache: 'Cache',
    ram: 'RAM',
    syncStart: 'Sync+Start',
    start: 'Start',
    newStart: 'New+Start',
    guiDisabled: 'GUI Disabled',
    noOs: 'No operating systems configured',
    by: 'by',
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

export function LinboGuiPreview({ osEntries, linboSettings, getIconUrl }: LinboGuiPreviewProps) {
  const labels = getLabels(linboSettings.locale);
  const visibleOs = osEntries.filter(os => !os.hidden);
  const isMinimal = linboSettings.useminimallayout === true;
  const isGuiDisabled = linboSettings.guidisabled === true;
  const showStatusBar = linboSettings.clientdetailsvisiblebydefault !== false && !isMinimal;
  const groupName = linboSettings.group || '---';
  const cacheDev = linboSettings.cache || '---';

  return (
    <div
      className="relative rounded-xl overflow-hidden select-none"
      style={{
        background: 'linear-gradient(135deg, #0a0a0a 0%, #0d1117 50%, #0a0f14 100%)',
        aspectRatio: '16 / 10',
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      }}
    >
      {/* Subtle mesh overlay */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: 'radial-gradient(circle at 85% 10%, rgba(0,129,198,0.15) 0%, transparent 50%), radial-gradient(circle at 15% 90%, rgba(143,192,70,0.08) 0%, transparent 50%)',
        }}
      />

      {/* Content container */}
      <div className="relative z-10 flex flex-col h-full p-4 sm:p-6">
        {/* Header: LINBO logo text */}
        <div className="text-center mb-3 sm:mb-4 flex-shrink-0">
          <h1
            className="text-xl sm:text-2xl font-bold tracking-[0.3em] text-white/90"
            style={{ textShadow: '0 2px 8px rgba(0,0,0,0.3)' }}
          >
            LINBO
          </h1>
          <div className="text-[9px] sm:text-[10px] text-white/40 tracking-wider mt-0.5">
            {labels.by} edulution
          </div>
        </div>

        {/* OS Cards area — scrollable */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {visibleOs.length === 0 ? (
            <EmptyState label={labels.noOs} />
          ) : (
            <OsCardGrid
              osEntries={visibleOs}
              getIconUrl={getIconUrl}
              labels={labels}
              isMinimal={isMinimal}
              isDisabled={isGuiDisabled}
            />
          )}
        </div>

        {/* Footer area */}
        <div className="flex-shrink-0 mt-2 sm:mt-3">
          {/* Footer info line */}
          <div className="flex items-center justify-between text-[8px] sm:text-[9px] text-white/30 mb-1.5">
            <span>LINBO 4.3 &middot; {linboSettings.server || '10.0.0.1'}</span>
            <div className="flex items-center gap-2">
              <button className="text-white/30 hover:text-white/60 transition-colors" title="Settings">
                <Settings className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              </button>
              <button className="text-white/30 hover:text-white/60 transition-colors" title="Reload">
                <RefreshCw className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              </button>
              <button className="text-white/30 hover:text-white/60 transition-colors" title="Power">
                <Power className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              </button>
            </div>
          </div>

          {/* Status bar */}
          {showStatusBar && (
            <StatusBar
              labels={labels}
              groupName={groupName}
              cacheDev={cacheDev}
            />
          )}
        </div>
      </div>

      {/* GUI Disabled overlay */}
      {isGuiDisabled && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="text-center">
            <div className="text-lg sm:text-xl font-bold text-white/80 tracking-wide">
              {labels.guiDisabled}
            </div>
            <div className="text-xs text-white/40 mt-1">guidisabled = true</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Sub-components ----------

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-2">
          <Play className="w-5 h-5 text-white/20" />
        </div>
        <p className="text-xs text-white/30">{label}</p>
      </div>
    </div>
  );
}

interface OsCardGridProps {
  osEntries: OsEntryData[];
  getIconUrl: (baseName: string) => string;
  labels: Record<string, string>;
  isMinimal: boolean;
  isDisabled: boolean;
}

function OsCardGrid({ osEntries, getIconUrl, labels, isMinimal, isDisabled }: OsCardGridProps) {
  const count = osEntries.length;

  // Layout: 1-2 OS = single column, 3-4 = 2-col grid
  const gridClass = count >= 3
    ? 'grid grid-cols-2 gap-2 sm:gap-3'
    : 'flex flex-col gap-2 sm:gap-3 items-center';

  return (
    <div className={gridClass}>
      {osEntries.map((os, i) => (
        <OsCard
          key={i}
          os={os}
          getIconUrl={getIconUrl}
          labels={labels}
          isMinimal={isMinimal}
          isDisabled={isDisabled}
          isSingleColumn={count < 3}
        />
      ))}
    </div>
  );
}

interface OsCardProps {
  os: OsEntryData;
  getIconUrl: (baseName: string) => string;
  labels: Record<string, string>;
  isMinimal: boolean;
  isDisabled: boolean;
  isSingleColumn: boolean;
}

function OsCard({ os, getIconUrl, labels, isMinimal, isDisabled, isSingleColumn }: OsCardProps) {
  const [imgError, setImgError] = useState(false);
  const iconName = os.iconName || 'unknown';
  const iconSrc = imgError ? FALLBACK_ICON : getIconUrl(iconName);
  const hasAnyButton = os.syncEnabled || os.startEnabled || os.newEnabled;

  return (
    <div
      className={`
        rounded border border-[#333333]
        transition-all duration-200
        ${isDisabled ? 'opacity-50 pointer-events-none' : 'hover:border-white/20 hover:bg-white/[0.06]'}
        ${isSingleColumn ? 'w-full max-w-md' : ''}
      `}
      style={{
        background: 'rgba(255,255,255,0.05)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.05)',
      }}
    >
      <div className={`flex items-center ${isMinimal ? 'p-2 sm:p-2.5' : 'p-2.5 sm:p-3'}`}>
        {/* Icon */}
        <div className="flex-shrink-0 w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-white/5 flex items-center justify-center mr-2.5 sm:mr-3">
          <img
            src={iconSrc}
            alt={os.name}
            className="w-6 h-6 sm:w-7 sm:h-7 object-contain"
            onError={() => setImgError(true)}
          />
        </div>

        {/* Text — hidden in minimal mode */}
        {!isMinimal && (
          <div className="flex-1 min-w-0 mr-2">
            <div className="text-xs sm:text-sm font-semibold text-white truncate">
              {os.name || 'Unbenannt'}
            </div>
            {os.version && (
              <div className="text-[9px] sm:text-[10px] text-white/40 truncate">
                {os.version}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action buttons */}
      {hasAnyButton && (
        <div className={`flex gap-1.5 px-2.5 sm:px-3 pb-2.5 sm:pb-3 ${isMinimal ? 'pt-0' : ''}`}>
          {os.syncEnabled && (
            <ActionButton
              icon={<RefreshCw className="w-2.5 h-2.5 sm:w-3 sm:h-3" />}
              label={isMinimal ? '' : labels.syncStart}
              color="#8fc046"
            />
          )}
          {os.startEnabled && (
            <ActionButton
              icon={<Play className="w-2.5 h-2.5 sm:w-3 sm:h-3" />}
              label={isMinimal ? '' : labels.start}
              color="#0081c6"
            />
          )}
          {os.newEnabled && (
            <ActionButton
              icon={<RotateCcw className="w-2.5 h-2.5 sm:w-3 sm:h-3" />}
              label={isMinimal ? '' : labels.newStart}
              color="#dc2626"
            />
          )}
        </div>
      )}
    </div>
  );
}

interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  color: string;
}

function ActionButton({ icon, label, color }: ActionButtonProps) {
  return (
    <button
      type="button"
      className="flex items-center gap-1 rounded-full px-2 sm:px-2.5 py-1 sm:py-1.5 text-[8px] sm:text-[9px] font-medium text-white transition-all duration-150 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"
      style={{
        backgroundColor: color,
        boxShadow: `0 2px 8px ${color}40`,
      }}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
}

interface StatusBarProps {
  labels: Record<string, string>;
  groupName: string;
  cacheDev: string;
}

function StatusBar({ labels, groupName, cacheDev }: StatusBarProps) {
  const items = [
    { label: labels.hostname, value: '---' },
    { label: labels.group, value: groupName },
    { label: labels.ip, value: '---' },
    { label: labels.hdd, value: '---' },
    { label: labels.cache, value: cacheDev },
    { label: labels.ram, value: '---' },
  ];

  return (
    <div
      className="px-3 py-1.5 sm:py-2"
      style={{
        background: 'rgba(255,255,255,0.02)',
      }}
    >
      <div className="flex flex-wrap gap-y-0.5 text-[8px] sm:text-[9px] items-center">
        {items.map((item, i) => (
          <span key={item.label} className="flex items-center">
            {i > 0 && <span className="text-white/15 mx-2">&middot;</span>}
            <span className="text-white/25">{item.label}: </span>
            <span className="text-white/50 font-medium">{item.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

