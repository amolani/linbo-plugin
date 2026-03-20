import { useState, useEffect } from 'react';
import { systemApi } from '@/api/system';
import type { ConfigOs, LinboSettings, GrubThemeConfig } from '@/types';

type OsEntryData = Omit<ConfigOs, 'id' | 'configId'>;

interface GrubMenuPreviewProps {
  osEntries: OsEntryData[];
  linboSettings: LinboSettings;
  themeConfig?: GrubThemeConfig | null;
  getIconUrl: (baseName: string, suffix?: string) => string;
}

const DEFAULT_THEME: GrubThemeConfig = {
  desktopColor: '#2a4457',
  itemColor: '#cccccc',
  selectedItemColor: '#ffffff',
  timeoutColor: '#cccccc',
  timeoutText: 'Starte in %d Sekunden ...',
  iconWidth: 32,
  iconHeight: 32,
  itemHeight: 40,
  itemSpacing: 4,
  itemIconSpace: 8,
  logoFile: 'linbo_logo.png',
  logoWidth: 96,
  logoHeight: 96,
};

interface MenuEntry {
  label: string;
  iconUrl: string;
}

function buildMenuEntries(
  osEntries: OsEntryData[],
  getIconUrl: (baseName: string, suffix?: string) => string
): MenuEntry[] {
  const entries: MenuEntry[] = [
    { label: 'LINBO', iconUrl: getIconUrl('linbo') },
  ];

  for (const os of osEntries) {
    const icon = os.iconName || 'unknown';
    const name = os.name || 'Unbenannt';
    entries.push(
      { label: `${name} (Start)`, iconUrl: getIconUrl(icon, '_start') },
      { label: `${name} (Linbo-Start)`, iconUrl: getIconUrl(icon, '_start') },
      { label: `${name} (Sync+Start)`, iconUrl: getIconUrl(icon, '_syncstart') },
      { label: `${name} (Neu+Start)`, iconUrl: getIconUrl(icon, '_newstart') },
    );
  }

  return entries;
}

export function GrubMenuPreview({ osEntries, linboSettings, themeConfig: themeConfigProp, getIconUrl }: GrubMenuPreviewProps) {
  const [loadedTheme, setLoadedTheme] = useState<GrubThemeConfig | null>(null);

  useEffect(() => {
    if (!themeConfigProp) {
      systemApi.getGrubThemeStatus()
        .then(s => setLoadedTheme(s.config))
        .catch(() => {});
    }
  }, [themeConfigProp]);

  const theme = themeConfigProp || loadedTheme || DEFAULT_THEME;
  const entries = buildMenuEntries(osEntries, getIconUrl);
  const boottimeout = linboSettings.boottimeout ?? 0;
  const scale = 0.7;

  const iconW = Math.round((theme.iconWidth || 32) * scale);
  const iconH = Math.round((theme.iconHeight || 32) * scale);
  const itemH = Math.round((theme.itemHeight || 40) * scale);
  const itemSpacing = Math.round((theme.itemSpacing || 4) * scale);
  const itemIconSpace = Math.round((theme.itemIconSpace || 8) * scale);
  const logoW = Math.round((theme.logoWidth || 96) * scale);
  const logoH = Math.round((theme.logoHeight || 96) * scale);

  const timeoutDisplay = boottimeout > 0
    ? (theme.timeoutText || DEFAULT_THEME.timeoutText).replace(/%d/g, String(boottimeout))
    : null;

  const handleImgError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    (e.target as HTMLImageElement).style.visibility = 'hidden';
  };

  return (
    <div
      className="rounded-lg overflow-hidden relative select-none"
      style={{
        backgroundColor: theme.desktopColor || DEFAULT_THEME.desktopColor,
        aspectRatio: '16 / 10',
      }}
    >
      {/* Menu entries */}
      <div
        className="overflow-y-auto px-4 pt-4"
        style={{ maxHeight: 'calc(100% - 40px)' }}
      >
        {entries.map((entry, i) => {
          const isSelected = i === 0;
          return (
            <div
              key={i}
              className="flex items-center rounded px-2 transition-colors"
              style={{
                height: `${itemH}px`,
                marginBottom: `${itemSpacing}px`,
                backgroundColor: isSelected ? 'rgba(255,255,255,0.15)' : 'transparent',
                color: isSelected
                  ? (theme.selectedItemColor || DEFAULT_THEME.selectedItemColor)
                  : (theme.itemColor || DEFAULT_THEME.itemColor),
              }}
            >
              <img
                src={entry.iconUrl}
                alt=""
                style={{ width: `${iconW}px`, height: `${iconH}px`, marginRight: `${itemIconSpace}px` }}
                className="flex-shrink-0 object-contain"
                onError={handleImgError}
              />
              <span className="text-xs truncate" style={{ fontSize: `${Math.max(10, Math.round(13 * scale))}px` }}>
                {entry.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Bottom bar: timeout text + logo */}
      <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between px-3 pb-2">
        <div className="text-[10px]" style={{ color: boottimeout > 0 ? (theme.timeoutColor || DEFAULT_THEME.timeoutColor) : '#888' }}>
          {timeoutDisplay || 'Kein Timeout'}
        </div>
        <img
          src="/api/v1/system/grub-theme/logo"
          alt=""
          style={{ width: `${logoW}px`, height: `${logoH}px` }}
          className="object-contain opacity-80"
          onError={handleImgError}
        />
      </div>
    </div>
  );
}
