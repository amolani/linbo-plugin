import { GrubThemeManager } from '@/components/system/GrubThemeManager';

export function GrubThemePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">GRUB Theme</h1>
        <p className="text-muted-foreground mt-1">
          Erscheinungsbild des GRUB-Bootmenus anpassen: Farben, Logo, Icons
        </p>
      </div>
      <GrubThemeManager />
    </div>
  );
}
