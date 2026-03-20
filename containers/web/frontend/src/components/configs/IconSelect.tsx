import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

interface IconSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  getIconUrl: (baseName: string) => string;
  label?: string;
}

export function IconSelect({ value, onChange, options, getIconUrl, label }: IconSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setFilter('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && filterRef.current) {
      filterRef.current.focus();
    }
  }, [isOpen]);

  const selectedOption = options.find(o => o.value === value);
  const filteredOptions = filter
    ? options.filter(o => o.label.toLowerCase().includes(filter.toLowerCase()) || o.value.toLowerCase().includes(filter.toLowerCase()))
    : options;

  const handleImgError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    (e.target as HTMLImageElement).style.display = 'none';
    const sibling = (e.target as HTMLImageElement).nextElementSibling;
    if (sibling) (sibling as HTMLElement).style.display = 'block';
  };

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label className="block text-sm font-medium text-foreground mb-1">{label}</label>
      )}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-3 py-2 border border-border rounded-md bg-input text-foreground text-sm hover:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <span className="flex items-center gap-2 flex-1 min-w-0">
          <img
            src={getIconUrl(value || 'unknown')}
            alt=""
            className="w-5 h-5 flex-shrink-0"
            onError={handleImgError}
          />
          <span className="hidden" style={{ display: 'none' }}>
            <span className="w-5 h-5 bg-muted rounded flex-shrink-0 inline-block" />
          </span>
          <span className="truncate">{selectedOption?.label || value || 'Auswaehlen...'}</span>
        </span>
        <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-card border border-border rounded-md shadow-lg max-h-60 overflow-hidden flex flex-col">
          <div className="p-2 border-b border-border">
            <input
              ref={filterRef}
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Suchen..."
              className="w-full px-2 py-1 text-sm border border-border rounded bg-input text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="overflow-y-auto flex-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">Keine Ergebnisse</div>
            ) : (
              filteredOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                    setFilter('');
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/50 transition-colors ${
                    option.value === value ? 'bg-primary/10 text-primary' : 'text-foreground'
                  }`}
                >
                  <img
                    src={getIconUrl(option.value)}
                    alt=""
                    className="w-6 h-6 flex-shrink-0"
                    onError={handleImgError}
                  />
                  <span className="hidden" style={{ display: 'none' }}>
                    <span className="w-6 h-6 bg-muted rounded flex-shrink-0 inline-block" />
                  </span>
                  <span className="truncate">{option.label}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
