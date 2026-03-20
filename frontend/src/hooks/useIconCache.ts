import { useState, useEffect, useCallback, useMemo } from 'react';
import { systemApi } from '@/api/system';
import type { GrubIcon } from '@/types';

const ICON_LABELS: Record<string, string> = {
  win10: 'Windows 10/11',
  win: 'Windows (allg.)',
  ubuntu: 'Ubuntu',
  kubuntu: 'Kubuntu',
  xubuntu: 'Xubuntu',
  lubuntu: 'Lubuntu',
  debian: 'Debian',
  linuxmint: 'Linux Mint',
  fedora: 'Fedora',
  opensuse: 'openSUSE',
  arch: 'Arch Linux',
  centos: 'CentOS',
  gentoo: 'Gentoo',
  linux: 'Linux (generisch)',
  unknown: 'Unbekannt',
};

export function useIconCache() {
  const [icons, setIcons] = useState<GrubIcon[]>([]);
  const [cacheKey, setCacheKey] = useState(Date.now());

  const loadIcons = useCallback(() => {
    systemApi.getGrubThemeIcons().then(setIcons).catch(() => {});
  }, []);

  useEffect(() => {
    loadIcons();
  }, [loadIcons]);

  const getIconUrl = useCallback((baseName: string, suffix = '') => {
    return `/api/v1/system/grub-theme/icons/${baseName}${suffix}.png?v=${cacheKey}`;
  }, [cacheKey]);

  const iconOptions = useMemo(() => {
    return icons
      .filter(i => i.baseName !== 'linbo')
      .map(i => ({
        value: i.baseName,
        label: i.isCustom
          ? `${i.baseName} (custom)`
          : (ICON_LABELS[i.baseName] || i.baseName),
      }));
  }, [icons]);

  const refreshIcons = useCallback(() => {
    setCacheKey(Date.now());
    loadIcons();
  }, [loadIcons]);

  return { icons, iconOptions, getIconUrl, refreshIcons };
}
