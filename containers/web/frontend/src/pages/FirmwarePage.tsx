import { FirmwareManager } from '@/components/system/FirmwareManager';

export function FirmwarePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Firmware & WLAN</h1>
        <p className="text-muted-foreground">
          Firmware-Dateien und WLAN-Konfiguration fuer das linbofs64-Initramfs verwalten
        </p>
      </div>

      <FirmwareManager />
    </div>
  );
}
