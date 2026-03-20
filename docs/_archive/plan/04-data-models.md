# LINBO Docker - Datenmodelle

## Übersicht

Dieses Dokument definiert alle Datenmodelle für die LINBO-Docker-Lösung.

---

## Core Models

### Host (Client)

Repräsentiert einen LINBO-Client (PXE-Boot-Computer).

```typescript
interface Host {
  // Identifikation
  id: string;                          // UUID (z.B. "host_abc123")
  hostname: string;                    // Eindeutiger Hostname (z.B. "pc01")
  macAddress: string;                  // MAC-Adresse (z.B. "00:11:22:33:44:55")

  // Netzwerk
  ipAddress?: string;                  // Aktuelle IP (dynamisch)

  // Zuordnung
  roomId?: string;                     // Raum-ID
  groupId?: string;                    // Gruppen-ID
  configId?: string;                   // Konfiguration-ID

  // Status
  status: HostStatus;
  lastSeen?: Date;
  bootMode?: BootMode;

  // Hardware (optional, vom Client gemeldet)
  hardware?: HardwareInfo;

  // Cache-Partition Info
  cache?: CacheInfo;

  // Metadaten
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, any>;
}

enum HostStatus {
  ONLINE = "online",
  OFFLINE = "offline",
  BOOTING = "booting",
  SYNCING = "syncing",
  CREATING_IMAGE = "creating_image",
  UPLOADING = "uploading",
  ERROR = "error"
}

enum BootMode {
  GUI = "gui",
  NOGUI = "nogui",
  NOMENU = "nomenu",
  VNC = "vncserver",
  DEBUG = "debug"
}

interface HardwareInfo {
  cpu?: string;
  memory?: string;
  disk?: string;
  networkCards?: string[];
}

interface CacheInfo {
  device: string;                      // z.B. "/dev/sda2"
  totalSize: string;
  usedSize: string;
  freeSize: string;
}
```

### HostGroup

Logische Gruppierung von Hosts (z.B. nach Hardware-Typ).

```typescript
interface HostGroup {
  id: string;                          // UUID
  name: string;                        // Eindeutiger Name
  description?: string;

  // Zugeordnete Hosts
  hostIds: string[];

  // Standard-Konfiguration
  defaultConfigId?: string;

  // Default-Einstellungen
  defaults: GroupDefaults;

  // Metadaten
  createdAt: Date;
  updatedAt: Date;
}

interface GroupDefaults {
  downloadType: DownloadType;
  autoPartition: boolean;
  autoFormat: boolean;
  autoInitCache: boolean;
  locale: Locale;
  kernelOptions?: string[];
}

enum DownloadType {
  RSYNC = "rsync",
  MULTICAST = "multicast",
  TORRENT = "torrent"
}

enum Locale {
  DE_DE = "de-de",
  EN_GB = "en-gb",
  EN_US = "en-us",
  FR_FR = "fr-fr",
  ES_ES = "es-es"
}
```

### Room

Physischer Raum/Standort.

```typescript
interface Room {
  id: string;
  name: string;                        // z.B. "D2.1", "Computer Lab 1"
  description?: string;
  location?: string;

  // Zugeordnete Hosts
  hostIds: string[];

  createdAt: Date;
  updatedAt: Date;
}
```

---

## Configuration Models

### StartConfConfig

Repräsentiert eine vollständige start.conf Konfiguration.

```typescript
interface StartConfConfig {
  id: string;
  name: string;
  description?: string;
  version: string;                     // Semantische Version

  // Status
  status: ConfigStatus;

  // LINBO Global Settings
  linbo: LinboSettings;

  // Partitionen
  partitions: Partition[];

  // Betriebssysteme
  operatingSystems: OSDefinition[];

  // Zuweisungen
  appliedToGroups: string[];
  appliedToRooms: string[];
  appliedToHosts: string[];

  // Audit
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  approvedBy?: string;
  approvedAt?: Date;
}

enum ConfigStatus {
  DRAFT = "draft",
  PENDING_APPROVAL = "pending_approval",
  APPROVED = "approved",
  REJECTED = "rejected",
  ARCHIVED = "archived"
}

interface LinboSettings {
  cache: string;                       // Cache-Partition (z.B. "/dev/sda2")
  rootTimeout: number;                 // Timeout in Sekunden
  autoPartition: boolean;
  autoFormat: boolean;
  autoInitCache: boolean;
  downloadType: DownloadType;
  guiDisabled: boolean;
  useMinimalLayout: boolean;
  locale: Locale;
  kernelOptions: string[];
}
```

### Partition

```typescript
interface Partition {
  id: string;
  position: number;                    // Reihenfolge (1, 2, 3, ...)

  device: string;                      // z.B. "/dev/sda1"
  label: string;                       // Partition-Name
  size: string;                        // z.B. "100G", "50G", "" (Rest)

  partitionId: number;                 // Typ-ID (7=NTFS, 83=Linux, 82=Swap)
  fsType: FileSystemType;
  bootable: boolean;
}

enum FileSystemType {
  NTFS = "ntfs",
  EXT4 = "ext4",
  EXT3 = "ext3",
  VFAT = "vfat",
  SWAP = "swap",
  REISERFS = "reiserfs"
}
```

### OSDefinition

```typescript
interface OSDefinition {
  id: string;
  position: number;                    // Position in start.conf

  // Basis-Info
  name: string;                        // z.B. "Windows 10"
  description: string;
  osType: OSType;
  iconName?: string;                   // z.B. "win10.svg"

  // Image
  baseImage: string;                   // z.B. "win10.qcow2"
  differentialImage?: string;          // z.B. "win10.qdiff"

  // Boot-Konfiguration
  root: string;                        // Root-Partition (z.B. "/dev/sda1")
  kernel: string;                      // Kernel-Pfad oder "auto"
  initrd: string;                      // Initrd-Pfad oder leer
  append: string[];                    // Kernel-Parameter

  // Client-Aktionen
  startEnabled: boolean;
  syncEnabled: boolean;
  newEnabled: boolean;

  // Autostart
  autostart: boolean;
  autostartTimeout: number;            // Sekunden
  defaultAction: DefaultAction;

  // Pre/Post Scripts
  prestartScript?: string;
  postsyncScript?: string;
}

enum OSType {
  WINDOWS = "windows",
  LINUX = "linux",
  OTHER = "other"
}

enum DefaultAction {
  START = "start",
  SYNC = "sync",
  NEW = "new"
}
```

---

## Image Models

### Image

```typescript
interface Image {
  id: string;
  filename: string;                    // z.B. "win10.qcow2"
  type: ImageType;

  // Datei-Info
  path: string;                        // Vollständiger Pfad
  size: number;                        // Bytes
  sizeHuman: string;                   // z.B. "5.2 GB"
  checksum: string;                    // SHA256

  // Für Differential Images
  backingImage?: string;               // Basis-Image Filename

  // Metadaten
  description?: string;
  comment?: string;

  // Torrent (optional)
  torrentFile?: string;

  // Status
  status: ImageStatus;

  // Verwendung
  usedInConfigs: string[];             // Config-IDs

  // Audit
  createdAt: Date;
  uploadedAt?: Date;
  createdBy?: string;
  lastUsedAt?: Date;
  lastUsedBy?: string;
}

enum ImageType {
  BASE = "base",                       // .qcow2
  DIFFERENTIAL = "differential"        // .qdiff
}

enum ImageStatus {
  AVAILABLE = "available",
  UPLOADING = "uploading",
  SYNCING = "syncing",
  CREATING = "creating",
  ERROR = "error"
}
```

---

## Operation Models

### Operation

Eine Operation ist eine Sammlung von Commands auf einem oder mehreren Hosts.

```typescript
interface Operation {
  id: string;

  // Ziele
  targetHosts: string[];               // Host-IDs
  targetGroups?: string[];             // Optional: Quell-Gruppen
  targetRooms?: string[];              // Optional: Quell-Räume

  // Commands
  commands: string[];                  // z.B. ["sync:1", "start:1"]

  // Optionen
  options: OperationOptions;

  // Status
  status: OperationStatus;
  progress: number;                    // 0-100

  // Sessions pro Host
  sessions: Session[];

  // Timing
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;

  // Statistik
  stats: OperationStats;
}

interface OperationOptions {
  wakeOnLan: boolean;
  wakeOnLanDelay: number;              // Sekunden
  disableGui: boolean;
  noAuto: boolean;
  onboot: boolean;                     // Für nächsten Boot
}

enum OperationStatus {
  PENDING = "pending",
  WAKING = "waking",                   // Wake-on-LAN Phase
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled"
}

interface OperationStats {
  totalHosts: number;
  completedHosts: number;
  failedHosts: number;
  pendingHosts: number;
}
```

### Session

Eine Session ist die Ausführung auf einem einzelnen Host.

```typescript
interface Session {
  id: string;
  operationId: string;
  hostId: string;
  hostname: string;

  // TMux Session
  tmuxSessionId?: string;

  // Commands in dieser Session
  commands: Command[];

  // Status
  status: SessionStatus;
  progress: number;

  // Logs
  logFile?: string;

  // Timing
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

enum SessionStatus {
  PENDING = "pending",
  WAITING_FOR_HOST = "waiting_for_host",
  CONNECTING = "connecting",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled"
}
```

### Command

Ein einzelner Befehl innerhalb einer Session.

```typescript
interface Command {
  id: string;
  sessionId: string;

  // Command Details
  name: CommandName;
  parameters?: Record<string, any>;
  rawCommand: string;                  // z.B. "sync:1"

  // Status
  status: CommandStatus;
  exitCode?: number;
  errorMessage?: string;

  // Timing
  startedAt?: Date;
  completedAt?: Date;
  duration?: number;                   // Sekunden
}

enum CommandName {
  PARTITION = "partition",
  LABEL = "label",
  FORMAT = "format",
  INITCACHE = "initcache",
  SYNC = "sync",
  NEW = "new",
  START = "start",
  PRESTART = "prestart",
  POSTSYNC = "postsync",
  CREATE_IMAGE = "create_image",
  CREATE_QDIFF = "create_qdiff",
  UPLOAD_IMAGE = "upload_image",
  UPLOAD_QDIFF = "upload_qdiff",
  REBOOT = "reboot",
  HALT = "halt",
  DISABLEGUI = "disablegui",
  NOAUTO = "noauto"
}

enum CommandStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  SKIPPED = "skipped"
}
```

---

## Progress Models

### SyncProgress

```typescript
interface SyncProgress {
  sessionId: string;
  hostId: string;

  osNumber: number;
  osName: string;

  // Fortschritt
  progress: number;                    // 0-100

  // Größen
  totalSize: number;                   // Bytes
  syncedSize: number;                  // Bytes
  totalSizeHuman: string;
  syncedSizeHuman: string;

  // Geschwindigkeit
  speed: number;                       // Bytes/Sekunde
  speedHuman: string;                  // z.B. "52 MB/s"

  // Zeit
  eta: number;                         // Sekunden bis fertig
  etaHuman: string;                    // z.B. "2m 15s"

  // Dateien
  filesTotal?: number;
  filesProcessed?: number;
  currentFile?: string;

  lastUpdate: Date;
}
```

### ImageCreationProgress

```typescript
interface ImageCreationProgress {
  sessionId: string;
  hostId: string;

  imageType: ImageType;
  targetImage: string;

  // Phase
  phase: CreationPhase;

  // Fortschritt
  progress: number;

  // Größen
  processedSize: number;
  totalSize?: number;

  // Zeit
  eta?: number;

  lastUpdate: Date;
}

enum CreationPhase {
  PREPARING = "preparing",
  MOUNTING = "mounting",
  SYNCING = "syncing",
  FINALIZING = "finalizing",
  CHECKSUMMING = "checksumming"
}
```

---

## Audit Models

### AuditLog

```typescript
interface AuditLog {
  id: string;
  timestamp: Date;

  // Akteur
  actor: string;                       // Username oder "system"
  actorType: ActorType;

  // Aktion
  action: AuditAction;

  // Ziel
  targetType: TargetType;
  targetId: string;
  targetName: string;

  // Details
  changes?: {
    before?: Record<string, any>;
    after?: Record<string, any>;
  };

  // Ergebnis
  status: AuditStatus;
  errorMessage?: string;

  // Request-Info
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

enum ActorType {
  USER = "user",
  SYSTEM = "system",
  API_KEY = "api_key"
}

enum AuditAction {
  // Host
  HOST_CREATED = "host.created",
  HOST_UPDATED = "host.updated",
  HOST_DELETED = "host.deleted",

  // Config
  CONFIG_CREATED = "config.created",
  CONFIG_UPDATED = "config.updated",
  CONFIG_APPROVED = "config.approved",
  CONFIG_APPLIED = "config.applied",

  // Image
  IMAGE_CREATED = "image.created",
  IMAGE_UPLOADED = "image.uploaded",
  IMAGE_DELETED = "image.deleted",

  // Operations
  OPERATION_STARTED = "operation.started",
  OPERATION_COMPLETED = "operation.completed",
  SYNC_EXECUTED = "sync.executed",
  FORMAT_EXECUTED = "format.executed",

  // Auth
  USER_LOGIN = "user.login",
  USER_LOGOUT = "user.logout"
}

enum TargetType {
  HOST = "host",
  GROUP = "group",
  ROOM = "room",
  CONFIG = "config",
  IMAGE = "image",
  OPERATION = "operation",
  USER = "user"
}

enum AuditStatus {
  SUCCESS = "success",
  FAILED = "failed"
}
```

---

## User Models

### User

```typescript
interface User {
  id: string;
  username: string;
  email?: string;

  // Authentifizierung
  passwordHash: string;

  // Rolle
  role: UserRole;

  // Status
  active: boolean;
  lastLogin?: Date;

  createdAt: Date;
  updatedAt: Date;
}

enum UserRole {
  ADMIN = "admin",
  OPERATOR = "operator",
  VIEWER = "viewer"
}
```

### APIKey

```typescript
interface APIKey {
  id: string;
  name: string;
  keyHash: string;                     // Gehashter Key

  // Berechtigungen
  permissions: Permission[];

  // Limits
  rateLimit?: number;                  // Requests pro Minute

  // Audit
  createdBy: string;
  createdAt: Date;
  expiresAt?: Date;
  lastUsedAt?: Date;
}

interface Permission {
  resource: string;                    // z.B. "hosts", "images"
  actions: string[];                   // z.B. ["read", "write"]
}
```

---

## Database Schema (SQL)

```sql
-- Hosts
CREATE TABLE hosts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname VARCHAR(255) UNIQUE NOT NULL,
  mac_address VARCHAR(17) UNIQUE NOT NULL,
  ip_address INET,
  room_id UUID REFERENCES rooms(id),
  group_id UUID REFERENCES host_groups(id),
  config_id UUID REFERENCES configs(id),
  status VARCHAR(50) DEFAULT 'offline',
  last_seen TIMESTAMP,
  boot_mode VARCHAR(50),
  hardware JSONB,
  cache_info JSONB,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Host Groups
CREATE TABLE host_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) UNIQUE NOT NULL,
  description TEXT,
  default_config_id UUID REFERENCES configs(id),
  defaults JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Rooms
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) UNIQUE NOT NULL,
  description TEXT,
  location VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Configurations
CREATE TABLE configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  version VARCHAR(50) NOT NULL,
  status VARCHAR(50) DEFAULT 'draft',
  linbo_settings JSONB NOT NULL,
  created_by VARCHAR(255),
  approved_by VARCHAR(255),
  approved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Partitions
CREATE TABLE config_partitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID REFERENCES configs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  device VARCHAR(50) NOT NULL,
  label VARCHAR(255),
  size VARCHAR(50),
  partition_id INTEGER,
  fs_type VARCHAR(50),
  bootable BOOLEAN DEFAULT FALSE
);

-- OS Definitions
CREATE TABLE config_os (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID REFERENCES configs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  os_type VARCHAR(50),
  icon_name VARCHAR(255),
  base_image VARCHAR(255),
  differential_image VARCHAR(255),
  root_device VARCHAR(50),
  kernel VARCHAR(255),
  initrd VARCHAR(255),
  append TEXT[],
  start_enabled BOOLEAN DEFAULT TRUE,
  sync_enabled BOOLEAN DEFAULT TRUE,
  new_enabled BOOLEAN DEFAULT TRUE,
  autostart BOOLEAN DEFAULT FALSE,
  autostart_timeout INTEGER DEFAULT 0,
  default_action VARCHAR(50),
  prestart_script TEXT,
  postsync_script TEXT
);

-- Config Assignments
CREATE TABLE config_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID REFERENCES configs(id) ON DELETE CASCADE,
  target_type VARCHAR(50) NOT NULL, -- 'group', 'room', 'host'
  target_id UUID NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Images
CREATE TABLE images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename VARCHAR(255) UNIQUE NOT NULL,
  type VARCHAR(50) NOT NULL,
  path VARCHAR(1024) NOT NULL,
  size BIGINT,
  checksum VARCHAR(64),
  backing_image VARCHAR(255),
  description TEXT,
  status VARCHAR(50) DEFAULT 'available',
  torrent_file VARCHAR(1024),
  created_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  uploaded_at TIMESTAMP,
  last_used_at TIMESTAMP,
  last_used_by VARCHAR(255)
);

-- Operations
CREATE TABLE operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_hosts UUID[] NOT NULL,
  commands TEXT[] NOT NULL,
  options JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(50) DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  stats JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);

-- Sessions
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID REFERENCES operations(id) ON DELETE CASCADE,
  host_id UUID REFERENCES hosts(id),
  hostname VARCHAR(255),
  tmux_session_id VARCHAR(255),
  status VARCHAR(50) DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  log_file VARCHAR(1024),
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);

-- Commands
CREATE TABLE session_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL,
  parameters JSONB,
  raw_command VARCHAR(255),
  status VARCHAR(50) DEFAULT 'pending',
  exit_code INTEGER,
  error_message TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);

-- Audit Logs
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMP DEFAULT NOW(),
  actor VARCHAR(255) NOT NULL,
  actor_type VARCHAR(50),
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50),
  target_id UUID,
  target_name VARCHAR(255),
  changes JSONB,
  status VARCHAR(50),
  error_message TEXT,
  ip_address INET,
  user_agent TEXT,
  request_id VARCHAR(255)
);

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255),
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'viewer',
  active BOOLEAN DEFAULT TRUE,
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- API Keys
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  key_hash VARCHAR(255) NOT NULL,
  permissions JSONB NOT NULL DEFAULT '[]',
  rate_limit INTEGER,
  created_by UUID REFERENCES users(id),
  expires_at TIMESTAMP,
  last_used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_hosts_status ON hosts(status);
CREATE INDEX idx_hosts_room ON hosts(room_id);
CREATE INDEX idx_hosts_group ON hosts(group_id);
CREATE INDEX idx_sessions_operation ON sessions(operation_id);
CREATE INDEX idx_sessions_host ON sessions(host_id);
CREATE INDEX idx_audit_timestamp ON audit_logs(timestamp);
CREATE INDEX idx_audit_actor ON audit_logs(actor);
CREATE INDEX idx_audit_target ON audit_logs(target_type, target_id);
```
