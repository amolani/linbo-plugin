// User & Auth
export interface User {
  id: string;
  username: string;
  email?: string;
  role: 'admin' | 'operator' | 'viewer';
  active: boolean;
  lastLogin?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

// Room
export interface Room {
  id: string;
  name: string;
  description?: string;
  location?: string;
  createdAt: string;
  updatedAt: string;
  hosts?: Host[];
  _count?: {
    hosts: number;
  };
}

// Host
export interface Host {
  id: string;
  hostname: string;
  macAddress: string;
  ipAddress?: string;
  roomId?: string;
  configId?: string;
  status: HostStatus;
  detectedOs?: 'linbo' | 'linux' | 'windows' | null;
  lastSeen?: string;
  lastOnlineAt?: string;
  bootMode?: string;
  hardware?: HardwareInfo;
  cacheInfo?: CacheInfo;
  metadata?: Record<string, unknown>;
  provisionStatus?: 'pending' | 'running' | 'synced' | 'failed' | null;
  provisionOpId?: string | null;
  createdAt: string;
  updatedAt: string;
  room?: Room;
  config?: Config;
}

export type HostStatus = 'online' | 'offline' | 'syncing' | 'booting' | 'unknown';

export interface HardwareInfo {
  cpu?: string;
  memory?: number;
  disk?: number;
  manufacturer?: string;
  model?: string;
}

export interface CacheInfo {
  size?: number;
  used?: number;
  images?: string[];
}

// Config
export interface Config {
  id: string;
  name: string;
  description?: string;
  version: string;
  status: 'draft' | 'active' | 'archived';
  linboSettings: LinboSettings;
  createdBy?: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
  partitions?: ConfigPartition[];
  osEntries?: ConfigOs[];
  _count?: {
    hosts: number;
  };
}

export interface LinboSettings {
  server?: string;
  group?: string;
  cache?: string;
  roottimeout?: number;
  autopartition?: boolean;
  autoformat?: boolean;
  autoinitcache?: boolean;
  autostart?: boolean;
  downloadType?: 'rsync' | 'torrent' | 'multicast';
  kerneloptions?: string;
  systemtype?: 'bios' | 'bios64' | 'efi32' | 'efi64';
  locale?: string;
  boottimeout?: number;
  backgroundfontcolor?: string;
  consolefontcolorsstdout?: string;
  consolefontcolorstderr?: string;
  guidisabled?: boolean;
  useminimallayout?: boolean;
  clientdetailsvisiblebydefault?: boolean;
  theme?: string;
}

export interface ConfigPartition {
  id: string;
  configId?: string;
  position: number;
  device: string;
  label?: string;
  size?: string;
  partitionId?: string;
  fsType?: string;
  bootable: boolean;
}

export interface ConfigOs {
  id: string;
  configId?: string;
  position: number;
  name: string;
  version?: string;
  description?: string;
  osType?: string;
  iconName?: string;
  image?: string;
  baseImage?: string;
  differentialImage?: string;
  rootDevice?: string;
  root?: string;
  kernel?: string;
  initrd?: string;
  append?: string[] | string;
  startEnabled: boolean;
  syncEnabled: boolean;
  newEnabled: boolean;
  autostart: boolean;
  autostartTimeout: number;
  defaultAction?: string;
  restoreOpsiState?: boolean;
  forceOpsiSetup?: string;
  hidden?: boolean;
  prestartScript?: string;
  postsyncScript?: string;
}

// Image Sidecar
export interface ImageSidecar {
  exists: boolean;
  size?: number;
  modifiedAt?: string;
}

export interface ImageSidecarSummary {
  hasInfo: boolean;
  hasDesc: boolean;
  hasTorrent: boolean;
  hasMd5: boolean;
  hasReg: boolean;
  hasPrestart: boolean;
  hasPostsync: boolean;
}

// Image
export interface Image {
  id: string;
  filename: string;
  type: 'base' | 'differential' | 'rsync';
  path: string;
  absolutePath?: string;
  size?: number;
  fileSize?: number;
  checksum?: string;
  backingImage?: string;
  description?: string;
  status: 'available' | 'uploading' | 'verifying' | 'error';
  torrentFile?: string;
  createdBy?: string;
  createdAt: string;
  uploadedAt?: string;
  lastUsedAt?: string;
  lastUsedBy?: string;
  sidecars?: Record<string, ImageSidecar>;
  sidecarSummary?: ImageSidecarSummary;
  imageInfo?: Record<string, string>;
  infoUpdatedAt?: string;
}

// Operation
export interface Operation {
  id: string;
  targetHosts: string[];
  commands: string[];
  options: Record<string, unknown>;
  status: OperationStatus;
  progress: number;
  stats?: OperationStats;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  sessions?: Session[];
}

export type OperationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'completed_with_errors' | 'cancelling';

export interface OperationStats {
  total: number;
  completed: number;
  failed: number;
  inProgress: number;
}

// Session
export interface Session {
  id: string;
  operationId?: string;
  hostId?: string;
  hostname?: string;
  tmuxSessionId?: string;
  status: SessionStatus;
  progress: number;
  logFile?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  host?: Host;
}

export type SessionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'queued' | 'success' | 'cancelled';

// Stats
export interface DashboardStats {
  hosts: {
    total: number;
    online: number;
    offline: number;
    syncing: number;
  };
  configs: number;
  rooms: number;
  images: {
    total: number;
    totalSize: number;
  };
  operations: {
    total: number;
    running: number;
    completed: number;
    failed: number;
  };
}

// API Response types
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiError {
  message: string;
  code?: string;
  details?: Record<string, unknown>;
}

// WebSocket events
export interface WsEventBase {
  type: string;
  timestamp: string;
  payload?: unknown; // Legacy compat — use getEventData() for safe access
}

export interface WsHostStatusEvent extends WsEventBase {
  type: 'host.status.changed';
  data: {
    hostId: string;
    hostname: string;
    status: HostStatus;
    detectedOs: string | null;
    lastSeen: string;
  };
}

export interface WsSyncProgressEvent extends WsEventBase {
  type: 'sync.progress';
  data: {
    hostId: string;
    hostname: string;
    progress: number;
    speed?: string;
    eta?: string;
  };
}

export interface WsOperationProgressEvent extends WsEventBase {
  type: 'operation.progress';
  data: {
    operationId: string;
    progress: number;
    stats: OperationStats;
  };
}

export interface WsNotificationEvent extends WsEventBase {
  type: 'notification';
  data: {
    level: 'info' | 'success' | 'warning' | 'error';
    title: string;
    message: string;
  };
}

export interface WsEntityChangeEvent extends WsEventBase {
  type: string;
  data: { id: string; name?: string };
}

export type WsEvent =
  | WsHostStatusEvent
  | WsSyncProgressEvent
  | WsOperationProgressEvent
  | WsNotificationEvent
  | WsEntityChangeEvent;

// DHCP
export interface NetworkSettings {
  dhcpServerIp: string;
  serverIp: string;
  subnet: string;
  netmask: string;
  gateway: string;
  dns: string;
  domain: string;
  dhcpRangeStart: string;
  dhcpRangeEnd: string;
  defaultLeaseTime: number;
  maxLeaseTime: number;
  lastExportedAt: string | null;
  updatedAt?: string;
}

export interface DhcpSummary {
  totalHosts: number;
  pxeHosts: number;
  staticIpHosts: number;
  dhcpIpHosts: number;
  configCounts: Record<string, number>;
  lastExportedAt: string | null;
  lastChangedAt: string | null;
  isStale: boolean;
}

export type DhcpFormat = 'isc-dhcp' | 'dnsmasq' | 'dnsmasq-proxy';

export interface DhcpExportOptions {
  format?: 'text' | 'file';
  configId?: string;
  roomId?: string;
  pxeOnly?: boolean;
  includeHeader?: boolean;
  includeSubnet?: boolean;
}

// Kernel
export interface KernelVariant {
  name: string;
  version: string;
  kernelSize: number;
  modulesSize: number;
  isActive: boolean;
  available: boolean;
}

export interface KernelStatus {
  variants: KernelVariant[];
  activeVariant: string;
  activeVersion: string;
  configValid: boolean;
  configWarning: string | null;
  hasTemplate: boolean;
  rebuildRunning: boolean;
  lastSwitchAt: string | null;
  lastError: string | null;
  currentLinbo64: {
    size: number;
    md5: string | null;
    modifiedAt: string | null;
  };
}

export interface KernelSwitchResponse {
  jobId: string;
  startedAt: string;
  requestedVariant: string;
}

// Firmware
export interface FirmwareEntry {
  entry: string;
  valid: boolean;
  exists: boolean;
  isFile?: boolean;
  isDirectory?: boolean;
  size?: number;
  isZst?: boolean;
  error?: string;
}

export interface FirmwareStats {
  total: number;
  valid: number;
  existing: number;
  missing: number;
  files: number;
  directories: number;
}

export interface FirmwareStatus {
  entries: FirmwareEntry[];
  stats: FirmwareStats;
  rebuildRunning: boolean;
  lastSwitchAt: string | null;
}

// Firmware Catalog
export interface FirmwareCatalogEntry {
  path: string;
  type: 'dir' | 'prefix';
  description: string;
  available: boolean;
  configured: boolean;
  configuredCount: number;
  totalCount: number;
  expandedFiles?: string[];
  configuredFiles?: string[];
}

export interface FirmwareCatalogVendor {
  id: string;
  name: string;
  category: string;
  description: string;
  entries: FirmwareCatalogEntry[];
  configuredCount: number;
  totalCount: number;
}

export interface FirmwareCatalogCategory {
  id: string;
  name: string;
  icon: string;
  vendors: FirmwareCatalogVendor[];
}

export interface BulkAddResult {
  added: string[];
  duplicates: string[];
  invalid: string[];
}

// WLAN
export interface WlanConfig {
  enabled: boolean;
  ssid: string;
  keyMgmt: 'WPA-PSK' | 'NONE';
  hasPsk: boolean;
  scanSsid: boolean;
}


// GRUB Theme
export interface GrubThemeConfig {
  desktopColor: string;
  itemColor: string;
  selectedItemColor: string;
  timeoutColor: string;
  timeoutText: string;
  iconWidth: number;
  iconHeight: number;
  itemHeight: number;
  itemSpacing: number;
  itemIconSpace: number;
  logoFile: string;
  logoWidth: number;
  logoHeight: number;
}

export interface GrubThemeStatus {
  config: GrubThemeConfig;
  logo: {
    file: string;
    size?: number;
    modifiedAt?: string;
    isCustom: boolean;
    hasDefault: boolean;
  };
  icons: {
    total: number;
    custom: number;
    default: number;
  };
}

export interface GrubIcon {
  baseName: string;
  variants: string[];
  isCustom: boolean;
}

// Log Panel
export type LogSeverity = 'error' | 'warn' | 'success' | 'info' | 'debug';
export type LogCategory =
  | 'host' | 'operation' | 'session' | 'sync' | 'config'
  | 'image' | 'system' | 'provision' | 'patchclass' | 'drivers' | 'rsync'
  | 'macct' | 'room' | 'notification' | 'other'
  // API log categories
  | 'http' | 'api' | 'ws' | 'redis' | 'db' | 'worker'
  // Container log categories
  | 'tftp' | 'ssh' | 'dhcp' | 'init' | 'cache' | 'web';

export type LogTab = 'events' | 'apiLogs' | 'container';

export interface LogEntry {
  id: number;
  timestamp: string;
  receivedAt: number;
  tab: LogTab;
  source?: string;
  type: string;
  category: LogCategory;
  severity: LogSeverity;
  summary: string;
  data: unknown;
  pinned: boolean;
}

// Filters
export interface HostFilters {
  search?: string;
  status?: HostStatus;
  roomId?: string;
  configId?: string;
}

// Table Column
import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  render?: (item: T) => ReactNode;
  className?: string;
}
