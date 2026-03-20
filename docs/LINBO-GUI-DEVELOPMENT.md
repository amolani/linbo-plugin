# LINBO GUI Development Guide

Vollständige Anleitung zum Bearbeiten, Bauen und Deployen der LINBO Qt6 GUI (PXE Boot Client Screen).

**Quellcode:** `/root/linuxmuster-linbo-gui/` (v7.3.3)
**Ziel-Design:** `/root/linbo-docker/containers/web/frontend/src/components/configs/LinboGuiPreview.tsx`
**Produktiv-Server:** 10.0.0.11 | **Test-Server (Docker):** 10.0.0.13 | **Test-VM:** "vier" (Gruppe amodrei)

---

## 1. Architektur-Überblick

### 1.1 Runtime-Umgebung

Die GUI läuft auf PXE-gebooteten Clients mit **linuxfb** (Framebuffer, keine GPU).

**Einschränkungen:**
- **Kein `QGraphicsDropShadowEffect`** — zu CPU-intensiv auf linuxfb. Stattdessen: `QPainter`-basierte Schatten (dunklere Unterlegung)
- **Kein Backdrop-Blur** — Qt linuxfb hat kein GPU-Compositing. Semi-transparente Fills auf dem Gradient simulieren Blur
- **Kein OpenGL** — alle Renderings über QPainter Software-Rendering
- **Kein QSS Gradient** — QSS unterstützt keine radialen/diagonalen Gradients. Custom `paintEvent()` nötig

### 1.2 Boot-Kette

```
GRUB (eigener Netzwerk-Stack, Port 69/HTTP)
  → Downloads: linbo64 (Kernel) + linbofs64 (Initramfs)
  → Kernel bootet (GRUB-Netzwerk weg)
  → init.sh → udevd → network() → udhcpc
  → rsync: start.conf + linbo_gui64_7.tar.lz
  → Extraktion → /usr/bin/linbo_gui startet Qt GUI
```

### 1.3 Datei-Architektur

```
/root/linuxmuster-linbo-gui/
├── headers/
│   ├── backend/           # Kernlogik (LinboBackend, LinboCMD, LinboConfig)
│   └── frontend/          # UI-Komponenten
│       ├── linbomainpage.h         # Hauptseite (Gradient, Header, Footer)
│       ├── linboosselectbutton.h   # OS-Karte (Glass Card)
│       ├── linboosselectionrow.h   # OS-Karten Grid
│       ├── linboguitheme.h         # Theme-System (Glassmorphism)
│       ├── linbomainactions.h      # Aktions-Buttons
│       ├── linboclientinfo.h       # Client-Info Statusbar
│       ├── components/             # 13 Basis-Widgets
│       │   ├── linbopushbutton.h       # Custom Button mit Overlay-System
│       │   ├── linbopushbuttonoverlay.h # Overlay-State-Management
│       │   ├── linboprogressbar.h      # Fortschrittsbalken
│       │   ├── linbodialog.h           # Modal-Dialog-Framework
│       │   └── ...
│       └── dialogs/                # 7 Modal-Dialoge
├── sources/
│   ├── main.cpp            # Entry Point
│   ├── linbogui.cpp        # Hauptfenster-Init
│   ├── backend/            # Kernlogik-Implementierung
│   └── frontend/           # UI-Implementierung (HIER wird gearbeitet)
│       ├── linbomainpage.cpp         # ★ Gradient + Header + Footer
│       ├── linboosselectbutton.cpp   # ★ Glass OS Card
│       ├── linboosselectionrow.cpp   # ★ Card Grid Layout
│       ├── linboguitheme.cpp         # ★ Theme-Helpers
│       ├── components/
│       │   ├── linbopushbutton.cpp   # ★ Pill Buttons
│       │   └── linboprogressbar.cpp  # ★ Progress Bar
│       └── dialogs/
├── resources/
│   ├── fonts/              # PT Sans (Body) + Ubuntu Mono (Terminal)
│   ├── icons/              # SVG Icons (dark/, light/, universal/)
│   ├── os-icons/           # OS-Logos (win10.svg, ubuntu.svg, etc.)
│   └── translations/       # 31 Sprachen (.ts Dateien)
├── build/
│   └── linbo_gui           # ★ Kompiliertes Binary (23 MB ELF)
└── CMakeLists.txt          # Build-Config (Qt6, CMake)
```

**★ = Dateien die bei GUI-Redesign typischerweise geändert werden**

---

## 2. Schlüssel-Komponenten im Detail

### 2.1 LinboMainPage — Hauptseite

**Dateien:** `linbomainpage.h` / `linbomainpage.cpp`
**Verantwortlich für:** Gradient-Background, Header, Footer, Layout-Orchestrierung

```
┌──────────────────────────────────────┐
│          "L I N B O"                 │  ← _titleLabel (QLabel)
│       "by linuxmuster.net"          │  ← _subtitleLabel (QLabel)
│                                      │
│     ┌──────────────────────┐         │
│     │  OS Card 1           │         │  ← _osSelectionRow (LinboOsSelectionRow)
│     └──────────────────────┘         │
│     ┌──────────────────────┐         │
│     │  OS Card 2           │         │
│     └──────────────────────┘         │
│                                      │
│     [Progress / Actions]             │  ← _mainActions (LinboMainActions)
│                                      │
│  ┌─────────────────────────────────┐ │
│  │ Hostname: vier  IP: 10.0.0.x   │ │  ← _clientInfo (LinboClientInfo)
│  └─────────────────────────────────┘ │
│  LINBO 4.3.29 · 10.0.150.2    ⚙ ↻ ⏻│  ← Footer (footerWidget)
└──────────────────────────────────────┘
```

**Gradient Background** (`paintEvent`):
```cpp
// Base: 135° Linear Gradient Navy → Teal
QLinearGradient baseGrad(0, 0, width(), height());
baseGrad.setColorAt(0.0, QColor("#0f172a"));  // Dark Navy
baseGrad.setColorAt(0.5, QColor("#0d3b4e"));  // Deep Teal
baseGrad.setColorAt(1.0, QColor("#134e4a"));  // Teal

// Mesh overlays (deaktiviert mit LINBO_LOW_FX=1):
QRadialGradient meshCyan(width * 0.8, height * 0.15, width * 0.5);
meshCyan.setColorAt(0.0, QColor(6, 182, 212, 18));   // Cyan 7%
```

**Wichtig:** Alle Kind-Widgets müssen `WA_TranslucentBackground` setzen, sonst überdecken sie den Gradient.

### 2.2 LinboOsSelectButton — OS Glass Card

**Dateien:** `linboosselectbutton.h` / `linboosselectbutton.cpp`
**Verantwortlich für:** Einzelne OS-Karte mit Icon, Name, Version, Aktions-Pills

```
┌─────────────────────────────────────┐
│  ┌────┐  Windows 11                │  ← _osNameLabel
│  │icon│  Windows 11 1903           │  ← _osVersionLabel
│  └────┘                            │
│  [Start] [Neu+Start]              │  ← _startActionButtons (Pills)
└─────────────────────────────────────┘
```

#### Icon-Rendering (KRITISCH)

**Problem:** `LinboPushButton` hat `WA_StyledBackground = true` (Zeile 38 in linbopushbutton.cpp), was auf linuxfb einen grauen Platform-Hintergrund erzeugt. Dieser lässt sich NICHT zuverlässig per Stylesheet entfernen.

**Lösung:** Das Icon wird **NICHT** über LinboPushButton gerendert, sondern direkt per `QSvgRenderer` im eigenen `paintEvent()`:

```cpp
// Im Constructor:
this->_iconRenderer = new QSvgRenderer(icon, this);

// Button bekommt leeren Icon-Pfad — ist nur transparenter Click-Target:
this->_button = new LinboPushButton("", "", {...}, this);
this->_button->setAttribute(Qt::WA_TranslucentBackground);
this->_button->setAttribute(Qt::WA_StyledBackground, false);  // ← KRITISCH

// Im paintEvent:
if(this->_iconRenderer && this->_iconRenderer->isValid()) {
    int iconPad = iconSize * 0.12;
    this->_iconRenderer->render(&painter, QRectF(iconBgRect.adjusted(iconPad, ...)));
}
```

**Warum nicht einfach Stylesheet?**
- `WA_StyledBackground` in LinboPushButton ist fest eingebaut (Zeile 38)
- Auch `background: transparent` im QSS reicht nicht — der Platform-Renderer zeichnet trotzdem
- Overlay-System von LinboPushButton zeigt SVG-Widgets die den ganzen Button füllen
- `setVisibleAnimated(true)` in der Animation macht versteckte Overlays wieder sichtbar

#### Glass Card paintEvent

```cpp
void LinboOsSelectButton::paintEvent(QPaintEvent *event) {
    QPainter painter(this);
    painter.setRenderHint(QPainter::Antialiasing);
    int radius = 8;  // rounded-lg
    QRect cardRect = this->rect().adjusted(0, 0, -1, -1);

    // 1. Schatten (kein QGraphicsDropShadowEffect!)
    painter.setBrush(QColor(0, 0, 0, 30));         // rgba(0,0,0,0.12)
    painter.drawRoundedRect(cardRect.adjusted(0, 3, 0, 3), radius, radius);

    // 2. Glass Fill
    painter.setBrush(QColor(255, 255, 255, 13));    // bg-white/5
    painter.setPen(QPen(QColor(255, 255, 255, 25), 1));  // border-white/10
    painter.drawRoundedRect(cardRect, radius, radius);

    // 3. Inset Highlight (obere Kante)
    painter.setPen(QPen(QColor(255, 255, 255, 13), 1));
    painter.drawLine(left + radius, top + 1, right - radius, top + 1);

    // 4. Icon-Hintergrund (subtiles Glass-Quadrat)
    painter.setBrush(QColor(255, 255, 255, 13));    // bg-white/5
    painter.drawRoundedRect(iconBgRect, 6, 6);

    // 5. SVG Icon rendern
    this->_iconRenderer->render(&painter, iconRect);
}
```

#### Proportionen (Match mit Preview)

| Element | Anteil von Card-Höhe | Beispiel bei h=107px |
|---------|---------------------|---------------------|
| Padding | 8% | 9px |
| Icon | 33% | 35px |
| Name Font | 15% | 16px |
| Version Font | 10% | 11px |
| Action Pills | 18% | 19px |
| Pill Font | height * 0.5 | ~10px |

#### Aktions-Buttons (Pill Buttons)

```cpp
// Text-only Pills (keine SVG Icons — Preview hat auch keine):
LinboPushButton* actionButton = new LinboPushButton("", i.value(), this);

// Farben pro Action:
// StartOs:      #f59c00 (Amber)
// SyncOs:       #4caf50 (Green)
// ReinstallOs:  #e65100 (Deep Orange)
actionButton->setPillColor(QColor("#4caf50"));
```

**Wichtig:** ALLE aktivierten Actions werden als Pills gezeigt — auch die Default-Action:
```cpp
bool disabled = !this->_os->actionEnabled(startAction);
// NICHT: || this->_os->defaultAction() == startAction
// (Das war der alte Code — da Overlays entfernt wurden, brauchen wir alle Pills)
```

### 2.3 LinboOsSelectionRow — Card Grid

**Dateien:** `linboosselectionrow.h` / `linboosselectionrow.cpp`
**Verantwortlich für:** Positionierung und Animation der OS-Karten

**Layout-Regeln:**
```
1-2 OS:  Einzelne Spalte, zentriert
         Width: 38% des Bildschirms
         Height: max 35% der Selection Row

3-4 OS:  2-Spalten Grid
         Width: (screen - 3*spacing) / 2
         Height: max 35% der Selection Row
```

**Animation:** Positions-Änderungen werden mit `QPropertyAnimation` (300ms, InOutQuad) animiert.

### 2.4 LinboPushButton — Overlay-System

**Dateien:** `linbopushbutton.h` / `linbopushbutton.cpp`

Das ist die komplizierteste Widget-Klasse. Versteht man sie nicht, macht man Fehler.

#### Overlay-Typen

| Typ | Wann sichtbar | SVG |
|-----|--------------|-----|
| `Background` | Immer (Icon + Label) | OS-Icon SVG |
| `OnHover` | Maus über Button | overlayHovered.svg |
| `OnPressed` | Button gedrückt | overlayPressed.svg |
| `OnChecked` | Toggle-Status an | overlayChecked.svg |
| `OnKeyboardFocus` | Tab-Navigation | overlayKeyboardFocus.svg |

#### Icon-Only vs Icon+Label Modus

```
Icon-Only (leerer Label):
┌──────────────┐
│  ┌────────┐  │  SVG füllt gesamten Button
│  │  SVG   │  │
│  └────────┘  │
└──────────────┘

Icon+Label (Text gesetzt):
┌─────────────────────┐
│ ┌────┐              │  Icon = height × height (links)
│ │ SVG│  Label Text   │  Label = rechts davon, height * 1.1 Offset
│ └────┘              │  Font = height * 0.5
└─────────────────────┘
```

#### WA_StyledBackground Problem

```cpp
// Zeile 38 in linbopushbutton.cpp:
this->setAttribute(Qt::WA_StyledBackground, true);
```

Das bewirkt, dass die **Platform** (linuxfb) einen Standard-Button-Hintergrund zeichnet.
Auf Desktop unsichtbar (transparent), auf linuxfb **grau**.

**Lösung für transparente Buttons:**
```cpp
button->setAttribute(Qt::WA_StyledBackground, false);  // Platform-BG aus
button->setAttribute(Qt::WA_TranslucentBackground);     // Transparenz an
button->setAutoFillBackground(false);                    // Kein Auto-Fill
```

#### Pill-Button Stylesheet

```cpp
// setPillColor() triggert in resizeEvent():
"LinboPushButton {"
"  background-color: #4caf50;"  // Dynamisch aus _pillColor
"  border-radius: 9px;"         // height / 2 → perfekte Pill-Form
"  color: white;"
"  font-weight: bold;"
"  padding: 0 8px;"             // Horizontales Padding
"}"
"LinboPushButton:hover { background-color: lighter(115%); }"
"LinboPushButton:pressed { background-color: darker(125%); }"
```

#### Overlay Muting

Um Overlays zu deaktivieren ohne sie zu entfernen:
```cpp
button->setOverlayTypeMuted(LinboPushButtonOverlay::OnChecked, true);
button->setOverlayTypeMuted(LinboPushButtonOverlay::OnHover, true);
button->setOverlayTypeMuted(LinboPushButtonOverlay::OnPressed, true);
```

### 2.5 LinboGuiTheme — Theme-System

**Dateien:** `linboguitheme.h` / `linboguitheme.cpp`
**Singleton:** `gTheme` (globaler Zugriff)

#### Glass-Helpers

```cpp
gTheme->glassBg()       // QColor(255, 255, 255, 13)  — rgba(255,255,255,0.05)
gTheme->glassBorder()   // QColor(255, 255, 255, 25)  — rgba(255,255,255,0.10)
gTheme->textAt(230)     // QColor(255, 255, 255, 230) — Text bei 90% Opacity
gTheme->textAt(100)     // QColor(255, 255, 255, 100) — Text bei 40% Opacity
gTheme->textAt(77)      // QColor(255, 255, 255, 77)  — Text bei 30% Opacity
gTheme->lowFxMode()     // true wenn LINBO_LOW_FX gesetzt
```

#### Farb-Palette

| Rolle | Farbe | Verwendung |
|-------|-------|------------|
| BackgroundColor | `#0f172a` | Gradient-Start (Navy) |
| TextColor | `#ffffff` | Standard-Text |
| AccentColor | `#f59c00` | Focus-Underlines, Progress Bar |
| ToolButtonColor | `#f59c00` | Tool-Button Text |

#### Icon-Pfad Auflösung

```cpp
QString path = gTheme->iconPath(LinboTheme::StartLegacyIcon);
// Prüft: 1. Backend-Theme Custom-Icons
//        2. :/icons/universal/ (immer gleich)
//        3. :/icons/light/ oder :/icons/dark/ (je nach Hintergrund-Helligkeit)
```

---

## 3. Build-Prozess

### 3.1 Build-Container

```bash
docker run --rm \
  -v /root/linuxmuster-linbo-gui:/src \
  ghcr.io/linuxmuster/linuxmuster-linbo-gui-build \
  bash -c "cd /src/build && cmake -DCMAKE_BUILD_TYPE=Release .. && make -j\$(nproc)"
```

**Output:** `/root/linuxmuster-linbo-gui/build/linbo_gui` (23 MB ELF)

**Build-System:** CMake + Qt6 (Core, Gui, Widgets, Svg, SvgWidgets, Xml, LinguistTools)
**Compiler:** GCC 11, C++17
**Qt Version:** 6.5.2 (statisch gelinkt im Build-Container)
**Plattform-Plugin:** `QLinuxFbIntegrationPlugin` (linuxfb Framebuffer)

### 3.2 Nur geänderte Dateien neu kompilieren

Nach kleinen Änderungen kompiliert `make` nur die geänderten `.cpp` Dateien:
```bash
docker run --rm \
  -v /root/linuxmuster-linbo-gui:/src \
  ghcr.io/linuxmuster/linuxmuster-linbo-gui-build \
  bash -c "cd /src/build && make -j\$(nproc)"
```

### 3.3 Clean Build (bei CMake-Problemen)

```bash
docker run --rm \
  -v /root/linuxmuster-linbo-gui:/src \
  ghcr.io/linuxmuster/linuxmuster-linbo-gui-build \
  bash -c "cd /src/build && rm -rf CMakeCache.txt CMakeFiles && cmake -DCMAKE_BUILD_TYPE=Release .. && make -j\$(nproc)"
```

---

## 4. Deploy-Prozess (Schritt für Schritt)

### 4.1 Archiv-Format

Die GUI wird als `linbo_gui64_7.tar.lz` ausgeliefert:
- **Format:** XZ-komprimiertes tar (trotz `.lz` Endung!)
- **Inhalt:** `lib/` (Qt6 Shared Libraries) + `usr/bin/linbo_gui` (Binary)
- **Größe:** ~9.8 MB komprimiert
- **Prüfsumme:** MD5 in `linbo_gui64_7.tar.lz.md5`

### 4.2 Vollständiger Deploy-Ablauf

```bash
# === Schritt 1: Original-Archiv extrahieren ===
rm -rf /tmp/gui_repack
mkdir -p /tmp/gui_repack
xz -d < /srv/linbo/linbo_gui64_7.tar.lz | tar xf - -C /tmp/gui_repack

# === Schritt 2: Neues Binary einsetzen ===
cp /root/linuxmuster-linbo-gui/build/linbo_gui /tmp/gui_repack/usr/bin/linbo_gui

# === Schritt 3: Archiv neu packen ===
cd /tmp/gui_repack
tar cf - lib usr | xz -9 > /tmp/linbo_gui64_7.tar.lz

# === Schritt 4: Zum Test-Server kopieren ===
scp /tmp/linbo_gui64_7.tar.lz root@10.0.0.13:/tmp/

# === Schritt 5: In Docker Volume deployen ===
ssh root@10.0.0.13 "
  VOLUME=/var/lib/docker/volumes/linbo_srv_data/_data
  cp /tmp/linbo_gui64_7.tar.lz \$VOLUME/linbo_gui64_7.tar.lz
  cd \$VOLUME
  md5sum linbo_gui64_7.tar.lz > linbo_gui64_7.tar.lz.md5
  chown 1001:1001 linbo_gui64_7.tar.lz linbo_gui64_7.tar.lz.md5
"

# === Schritt 6: Test-VM "vier" per PXE neu booten ===
# (Im vSphere/Proxmox die VM neustarten)
```

### 4.3 Einzeiler (Build + Deploy)

```bash
# Build
docker run --rm -v /root/linuxmuster-linbo-gui:/src \
  ghcr.io/linuxmuster/linuxmuster-linbo-gui-build \
  bash -c "cd /src/build && make -j\$(nproc)" \
&& cp /root/linuxmuster-linbo-gui/build/linbo_gui /tmp/gui_repack/usr/bin/linbo_gui \
&& cd /tmp/gui_repack \
&& tar cf - lib usr | xz -9 > /tmp/linbo_gui64_7.tar.lz \
&& scp /tmp/linbo_gui64_7.tar.lz root@10.0.0.13:/tmp/ \
&& ssh root@10.0.0.13 "
  V=/var/lib/docker/volumes/linbo_srv_data/_data
  cp /tmp/linbo_gui64_7.tar.lz \$V/linbo_gui64_7.tar.lz
  cd \$V && md5sum linbo_gui64_7.tar.lz > linbo_gui64_7.tar.lz.md5
  chown 1001:1001 linbo_gui64_7.tar.lz linbo_gui64_7.tar.lz.md5
  echo DEPLOYED"
```

### 4.4 Kritische Details

| Detail | Wert | Konsequenz wenn falsch |
|--------|------|----------------------|
| Docker Volume Name | `linbo_srv_data` | Datei nicht gefunden (NICHT `linbo-docker_srv_data`) |
| Ownership | `1001:1001` | rsync-Container kann nicht lesen → Client bekommt alte GUI |
| MD5 Datei | Muss aktualisiert werden | Client erkennt Update nicht → lädt alte Version |
| XZ Format | `xz -9` (nicht gzip, nicht lzip) | Client kann nicht entpacken |
| Arbeitsverzeichnis beim tar | `/tmp/gui_repack/` | Falscher Pfad im Archiv → GUI startet nicht |

---

## 5. Design-Referenz (LinboGuiPreview.tsx)

Das Ziel-Design ist in der Web-Preview definiert:
`/root/linbo-docker/containers/web/frontend/src/components/configs/LinboGuiPreview.tsx`

### 5.1 Card-Styling

```
Tailwind:  rounded-lg border border-white/10 backdrop-blur-md
Inline:    background: rgba(255,255,255,0.05)
           boxShadow: 0 4px 16px rgba(0,0,0,0.2),
                      inset 0 1px 0 rgba(255,255,255,0.05)

Qt Äquivalent:
  painter.setBrush(QColor(255, 255, 255, 13));          // 0.05 * 255 = 13
  painter.setPen(QPen(QColor(255, 255, 255, 25), 1));   // 0.10 * 255 = 25
  painter.drawRoundedRect(cardRect, 8, 8);              // rounded-lg ≈ 8px
```

### 5.2 Icon

```
Tailwind:  w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-white/5
→ Kleine Box (32-40px), subtiler Glass-Hintergrund, Icon zentriert
```

### 5.3 Text

```
Name:     text-xs sm:text-sm font-semibold text-white        → ~14px bold white
Version:  text-[9px] sm:text-[10px] text-white/40            → ~10px white 40%
Footer:   text-[8px] sm:text-[9px] text-white/30             → ~9px white 30%
```

### 5.4 Action Pills

```
Tailwind:  rounded-full px-2 sm:px-2.5 py-1 sm:py-1.5
           text-[8px] sm:text-[9px] font-medium text-white
Inline:    backgroundColor: color
           boxShadow: 0 2px 8px ${color}40

Farben:    Sync+Start: #4caf50 (Green)
           Start:      #f59c00 (Amber)
           Neu+Start:  #e65100 (Deep Orange)
```

### 5.5 Statusbar

```
Tailwind:  rounded-lg border border-white/10
Inline:    background: rgba(255,255,255,0.04)
           boxShadow: inset 0 1px 0 rgba(255,255,255,0.03)
Labels:    text-white/30 (Keys) + text-white/60 font-medium (Values)
```

---

## 6. Häufige Aufgaben

### 6.1 Neue Farbe/Style ändern

1. **Theme-Helper in `linboguitheme.h/.cpp`** hinzufügen (wenn wiederverwendbar)
2. In der Komponente über `gTheme->...()` verwenden
3. Hardcoded Hex nur als Fallback mit `// fallback` Kommentar

### 6.2 Neues Widget zum Card hinzufügen

1. Member in `linboosselectbutton.h` deklarieren
2. Im Constructor erstellen + stylen
3. In `resizeEvent()` positionieren
4. In `setVisible()` und `_setVisibleAnimated()` Sichtbarkeit steuern

### 6.3 Card-Layout ändern

1. **Proportionen:** In `linboosselectbutton.cpp` `resizeEvent()` anpassen
2. **Grid:** In `linboosselectionrow.cpp` `_resizeAndPositionAllButtons()` anpassen
3. **Glassmorphism:** In `linboosselectbutton.cpp` `paintEvent()` anpassen

### 6.4 Neuen Dialog erstellen

1. Header in `headers/frontend/dialogs/`
2. Implementation in `sources/frontend/dialogs/`
3. In `linbomainpage.cpp` Constructor instanziieren
4. `setGeometry()`, `centerInParent()`, Connect-Signals
5. Zu `_allDialogs` Liste hinzufügen

---

## 7. Troubleshooting

### Graues Icon-Hintergrund

**Ursache:** `WA_StyledBackground` in LinboPushButton
**Lösung:** Icon per `QSvgRenderer` im eigenen `paintEvent()` rendern, Button als transparenten Click-Target verwenden

### Widget überdeckt Gradient

**Ursache:** Widget hat `autoFillBackground = true` oder fehlendes `WA_TranslucentBackground`
**Lösung:**
```cpp
widget->setAutoFillBackground(false);
widget->setAttribute(Qt::WA_TranslucentBackground);
```

### Overlay taucht nach Animation wieder auf

**Ursache:** `setVisibleAnimated(true)` zeigt Background-Overlays
**Lösung:** Button mit leerem Icon-Pfad erstellen (`""`) → kein SVG-Overlay wird erzeugt

### Action-Button fehlt

**Ursache:** `actionEnabled()` liefert false (start.conf: `StartEnabled = no`) oder Default-Action wird übersprungen
**Lösung:** Prüfe `start.conf` der Gruppe. Alle aktivierten Actions sollen als Pills erscheinen:
```cpp
bool disabled = !this->_os->actionEnabled(startAction);
// NICHT: || this->_os->defaultAction() == startAction
```

### Binary zu groß / Deploy schlägt fehl

**Ursache:** Falsches Archiv-Format oder fehlende MD5
**Lösung:** Exakt diesen Ablauf folgen: XZ-Extraktion → Binary ersetzen → XZ-Kompression → MD5 aktualisieren → chown 1001:1001

### LINBO_LOW_FX Modus

**Aktivierung:** `LINBO_LOW_FX=1` (oder `true`, `yes`) als Umgebungsvariable
**Effekt:** Deaktiviert radiale Mesh-Overlays im Gradient, nur flacher Linear-Gradient

---

## 8. Referenz: start.conf OS-Felder

```ini
[OS]
Name = Windows 11           # → _osNameLabel Text
Version = 22H2              # → _osVersionLabel Text (falls leer: Description)
Description = Windows 11    # → Tooltip + Fallback für Version
IconName = win11.png        # → SVG Icon-Pfad (/icons/win11.svg)
BaseImage = win11.qcow2     # → Wenn null: "No baseimage defined" (rot)
StartEnabled = yes          # → actionEnabled(StartOs)
SyncEnabled = no            # → actionEnabled(SyncOs)
NewEnabled = yes            # → actionEnabled(ReinstallOs)
DefaultAction = start       # → defaultAction() → Primary Click Action
Autostart = no              # → Autostart-Countdown
AutostartTimeout = 20       # → Sekunden bis Auto-Boot
Hidden = no                 # → OS in GUI verstecken
```

---

## 9. Checkliste für GUI-Änderungen

- [ ] Änderungen nur in `sources/frontend/` und `headers/frontend/`
- [ ] Keine `QGraphicsDropShadowEffect` verwenden (CPU-Last auf linuxfb)
- [ ] Farben über `gTheme->...()` oder benannte Konstanten
- [ ] `WA_TranslucentBackground` auf allen transparenten Containern
- [ ] Icons per `QSvgRenderer` rendern (nicht über LinboPushButton Icon-Pfad)
- [ ] Proportionen relativ zur Höhe berechnen (verschiedene Auflösungen!)
- [ ] Build erfolgreich: `build/linbo_gui` existiert als ELF
- [ ] Deploy: XZ-Archiv → Docker Volume → MD5 → chown 1001:1001
- [ ] PXE Boot Test auf VM "vier" (Gruppe amodrei)
- [ ] `LINBO_LOW_FX=1` verursacht keine visuellen Glitches
