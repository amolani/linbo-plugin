import { Menu as MenuIcon } from 'lucide-react';

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  return (
    <header className="lg:hidden bg-card border-b border-border">
      <div className="px-4">
        <div className="flex items-center h-14">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring rounded-md p-1"
            onClick={onMenuClick}
          >
            <span className="sr-only">Menü öffnen</span>
            <MenuIcon className="h-6 w-6" aria-hidden="true" />
          </button>
          <span className="ml-3 text-lg font-semibold text-foreground">LINBO Docker</span>
        </div>
      </div>
    </header>
  );
}
