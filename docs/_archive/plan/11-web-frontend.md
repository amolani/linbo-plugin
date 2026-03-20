# LINBO Docker - Web-Frontend Dokumentation

**Erstellt:** 2026-02-04 (Session 6)
**Status:** ✅ ABGESCHLOSSEN

---

## Übersicht

Das Web-Frontend ist eine Single-Page Application (SPA) basierend auf React 18 mit TypeScript. Es bietet eine moderne, responsive Benutzeroberfläche zur Verwaltung von LINBO-Clients.

### Tech Stack

| Technologie | Version | Zweck |
|-------------|---------|-------|
| React | 18.2.0 | UI Framework |
| TypeScript | 5.3.3 | Type Safety |
| Vite | 5.0.12 | Build Tool |
| Tailwind CSS | 3.4.1 | Styling |
| Headless UI | 1.7.18 | Accessible Components |
| Heroicons | 2.1.1 | Icons |
| Zustand | 4.5.0 | State Management |
| React Router | 6.22.0 | Routing |
| Axios | 1.6.7 | HTTP Client |

---

## Installation

### Entwicklung

```bash
cd containers/web/frontend

# Dependencies installieren
npm install

# Development Server starten
npm run dev
# → http://localhost:5173

# Type-Checking
npm run type-check

# Production Build
npm run build
# → dist/
```

### Docker Deployment

```bash
# Nur Web-Container bauen
docker compose build web

# Alle Container starten
docker compose up -d

# Frontend URL
http://localhost:8080
```

---

## Projektstruktur

```
containers/web/frontend/
├── index.html              # HTML Entry Point
├── package.json            # Dependencies & Scripts
├── package-lock.json       # Lock File
├── vite.config.ts          # Vite Konfiguration
├── tailwind.config.js      # Tailwind CSS Konfiguration
├── postcss.config.js       # PostCSS für Tailwind
├── tsconfig.json           # TypeScript Hauptconfig
├── tsconfig.node.json      # TypeScript für Node (Vite)
└── src/
    ├── main.tsx            # React Entry Point
    ├── App.tsx             # Root Component mit Router
    ├── index.css           # Tailwind Imports + Custom Styles
    ├── vite-env.d.ts       # Vite Type Declarations
    │
    ├── api/                # API Client Module
    │   ├── client.ts       # Axios Instance + JWT Interceptor
    │   ├── auth.ts         # Login, Logout, Register, Me
    │   ├── hosts.ts        # CRUD + WoL, Sync, Start, Bulk
    │   ├── groups.ts       # CRUD + Apply Config, Wake All
    │   ├── rooms.ts        # CRUD + Wake All, Shutdown All
    │   ├── configs.ts      # CRUD + Preview, Clone
    │   ├── images.ts       # CRUD + Register, Verify
    │   └── operations.ts   # CRUD + Send Command, Cancel
    │
    ├── stores/             # Zustand State Management
    │   ├── authStore.ts    # User, Token, Login/Logout (Persist)
    │   ├── hostStore.ts    # Hosts, Pagination, Filters, Selection
    │   ├── wsStore.ts      # WebSocket Connection, Subscriptions
    │   └── notificationStore.ts  # Toast Messages Queue
    │
    ├── hooks/              # Custom React Hooks
    │   ├── useAuth.ts      # Auth State + Actions
    │   ├── useWebSocket.ts # WS Connection + Event Handler
    │   └── useHosts.ts     # Host Data + Actions + Filters
    │
    ├── components/
    │   ├── ui/             # Reusable Base Components
    │   │   ├── index.ts    # Barrel Export
    │   │   ├── Button.tsx  # Primary/Secondary/Danger/Ghost
    │   │   ├── Input.tsx   # Text Input mit Label
    │   │   ├── Select.tsx  # Dropdown Select
    │   │   ├── Modal.tsx   # Dialog mit Headless UI
    │   │   ├── ConfirmModal.tsx  # Bestätigungs-Dialog
    │   │   ├── Table.tsx   # Sortierbare Tabelle
    │   │   ├── Pagination.tsx    # Seitennavigation
    │   │   ├── StatusBadge.tsx   # Host Status Anzeige
    │   │   └── OperationStatusBadge.tsx  # Operation Status
    │   │
    │   └── layout/         # Layout Components
    │       ├── AppLayout.tsx     # Hauptlayout mit Sidebar
    │       └── Sidebar.tsx       # Navigation Sidebar
    │
    ├── pages/              # Seiten-Komponenten
    │   ├── LoginPage.tsx         # Login Formular
    │   ├── DashboardPage.tsx     # Übersicht mit Stats
    │   ├── HostsPage.tsx         # Host-Verwaltung
    │   ├── RoomsPage.tsx         # Raum-Verwaltung
    │   ├── GroupsPage.tsx        # Gruppen-Verwaltung
    │   ├── ConfigsPage.tsx       # Konfigurations-Editor
    │   ├── ImagesPage.tsx        # Image-Verwaltung
    │   └── OperationsPage.tsx    # Operations-Monitor
    │
    ├── routes/             # Routing
    │   ├── index.tsx       # Route Definitions
    │   └── ProtectedRoute.tsx    # Auth Guard
    │
    └── types/              # TypeScript Definitionen
        └── index.ts        # Alle Interfaces
```

---

## Features

### 1. Authentifizierung
- JWT-basierte Authentifizierung
- Token wird im localStorage persistiert
- Automatische Weiterleitung bei Session-Ablauf
- Protected Routes für alle Seiten außer Login

### 2. Dashboard
- Statistik-Karten für Hosts (Online/Offline/Syncing)
- Image-Anzahl und Speichernutzung
- Aktive Operations
- Letzte Aktivitäten

### 3. Host-Verwaltung
- Tabelle mit Sortierung (Hostname, IP, Status)
- Filter nach Status, Raum, Gruppe, Suchbegriff
- Pagination (10, 25, 50, 100 Einträge)
- Bulk-Auswahl und Aktionen
- CRUD Modal (Create/Edit/Delete)
- Aktionen: Wake-on-LAN, Sync, Start

### 4. Räume & Gruppen
- Liste mit Host-Anzahl
- CRUD Modals
- Wake All / Shutdown All

### 5. Konfigurationen
- Liste mit Status (Draft/Active/Archived)
- Detaillierter Editor:
  - LINBO Settings
  - Partitionen-Tabelle
  - OS-Einträge
- start.conf Preview

### 6. Images
- Liste mit Dateigröße und Status
- Verifikations-Funktion
- Upload-Status Anzeige

### 7. Operations
- Echtzeit-Progress via WebSocket
- Session-Details pro Host
- Cancel-Funktion
- Status-Filter

### 8. Echtzeit-Updates
- WebSocket-Verbindung für Live-Daten
- Automatische Reconnection
- Event-basierte Updates:
  - `host.status.changed`
  - `sync.progress`
  - `operation.progress`
  - `notification`

---

## API Client

### Axios Konfiguration

```typescript
// src/api/client.ts
const apiClient = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// JWT Interceptor
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Error Handler
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);
```

### Beispiel API-Modul

```typescript
// src/api/hosts.ts
export const hostsApi = {
  list: (params) => apiClient.get('/hosts', { params }).then(r => r.data.data),
  get: (id) => apiClient.get(`/hosts/${id}`).then(r => r.data.data),
  create: (data) => apiClient.post('/hosts', data).then(r => r.data.data),
  update: (id, data) => apiClient.patch(`/hosts/${id}`, data).then(r => r.data.data),
  delete: (id) => apiClient.delete(`/hosts/${id}`),
  wakeOnLan: (id) => apiClient.post(`/hosts/${id}/wake-on-lan`).then(r => r.data.data),
  sync: (id, opts) => apiClient.post(`/hosts/${id}/sync`, opts).then(r => r.data.data),
  start: (id, osIdx) => apiClient.post(`/hosts/${id}/start`, { osIndex: osIdx }).then(r => r.data.data),
};
```

---

## State Management

### Zustand Store Beispiel

```typescript
// src/stores/authStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      login: (token, user) => set({ token, user, isAuthenticated: true }),
      logout: () => set({ token: null, user: null, isAuthenticated: false }),
    }),
    { name: 'auth-storage' }
  )
);
```

---

## Styling

### Tailwind CSS Konfiguration

```javascript
// tailwind.config.js
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          // ... bis 900
          600: '#0284c7',  // Hauptfarbe
        },
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};
```

### Farbschema

| Farbe | Hex | Verwendung |
|-------|-----|------------|
| Primary | #0284c7 | Buttons, Links, Akzente |
| Success | #22c55e | Online-Status, Erfolgsmeldungen |
| Warning | #f59e0b | Syncing-Status, Warnungen |
| Danger | #ef4444 | Offline-Status, Fehler, Löschen |
| Gray | #6b7280 | Text, Borders, Hintergründe |

---

## Docker Integration

### Dockerfile (Multi-Stage Build)

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Serve
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### nginx.conf

```nginx
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    # API Proxy
    location /api/ {
        proxy_pass http://api:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket Proxy
    location /ws {
        proxy_pass http://api:3000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }

    # Health Check
    location /health {
        proxy_pass http://api:3000/health;
    }

    # SPA Fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Static Asset Caching
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

---

## Bekannte Probleme

### 1. Storage Stats zeigen "NaN"
- **Beschreibung:** Wenn /srv/linbo leer ist, zeigt das Dashboard "NaN undefined"
- **Ursache:** API stats.js rechnet mit leeren Werten
- **Fix:** API-seitig Default-Werte setzen

### 2. Health-Checks manchmal "unhealthy"
- **Beschreibung:** Docker zeigt Container als unhealthy obwohl sie funktionieren
- **Ursache:** `wget --spider` hat Probleme mit JSON-Response
- **Fix:** Health-Check auf `curl` umstellen

---

## Weiterentwicklung

### Geplante Features
- [ ] Dark Mode
- [ ] Internationalisierung (i18n)
- [ ] Benutzer-Verwaltung im Frontend
- [ ] Erweiterte Rechte-Verwaltung
- [ ] Export/Import von Konfigurationen
- [ ] Audit-Log Ansicht
- [ ] Terminal für linbo-remote Befehle

### Performance-Optimierungen
- [ ] React.lazy für Code-Splitting
- [ ] Service Worker für Offline-Fähigkeit
- [ ] Image Lazy Loading
- [ ] Virtualisierte Listen für große Datenmengen

---

## Referenzen

- [React Dokumentation](https://react.dev)
- [Vite Guide](https://vitejs.dev/guide/)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [Headless UI](https://headlessui.com)
- [Zustand](https://github.com/pmndrs/zustand)
- [React Router](https://reactrouter.com)
