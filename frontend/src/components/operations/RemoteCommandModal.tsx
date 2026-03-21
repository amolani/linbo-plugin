import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus,
  X,
  Play,
  Clock,
  Monitor,
  Building2,
} from 'lucide-react';
import { Modal, Button, Input, Select } from '@/components/ui';
import { operationsApi, LINBO_COMMANDS, DirectCommandRequest, ScheduleCommandRequest } from '@/api/operations';
import { syncApi, SyncHost } from '@/api/sync';
import { notify } from '@/stores/notificationStore';

interface RemoteCommandModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  preselectedHostIds?: string[];
}

type TargetType = 'hosts' | 'hostgroup';
type ExecutionType = 'direct' | 'scheduled';

interface CommandItem {
  id: string;
  command: string;
  arg?: string;
}

export function RemoteCommandModal({
  isOpen,
  onClose,
  onSuccess,
  preselectedHostIds = [],
}: RemoteCommandModalProps) {
  const [targetType, setTargetType] = useState<TargetType>('hosts');
  const [executionType, setExecutionType] = useState<ExecutionType>('direct');
  const [selectedMacs, setSelectedMacs] = useState<string[]>([]);
  const [selectedHostgroup, setSelectedHostgroup] = useState<string>('');
  const [commands, setCommands] = useState<CommandItem[]>([]);
  const [wakeOnLan, setWakeOnLan] = useState(false);
  const [wolDelay, setWolDelay] = useState(30);
  const [isLoading, setIsLoading] = useState(false);

  const [syncHosts, setSyncHosts] = useState<SyncHost[]>([]);
  const [hostgroups, setHostgroups] = useState<string[]>([]);
  const [hostsLoading, setHostsLoading] = useState(true);

  // Load options on mount
  useEffect(() => {
    const loadOptions = async () => {
      setHostsLoading(true);
      try {
        const syncHostsData = await syncApi.getHosts();
        setSyncHosts(syncHostsData);
        // Extract unique hostgroups
        const groups = [...new Set(syncHostsData.map(h => h.hostgroup).filter(Boolean))];
        setHostgroups(groups.sort());
      } catch {
        notify.error('Fehler beim Laden der Optionen');
      } finally {
        setHostsLoading(false);
      }
    };
    if (isOpen) {
      loadOptions();
    }
  }, [isOpen]);

  // Reset on open with preselected hosts
  useEffect(() => {
    if (isOpen && preselectedHostIds.length > 0) {
      // preselectedHostIds may contain MACs in sync mode
      setSelectedMacs(preselectedHostIds);
      setTargetType('hosts');
    }
  }, [isOpen, preselectedHostIds]);

  const handleClose = useCallback(() => {
    setSelectedMacs([]);
    setSelectedHostgroup('');
    setCommands([]);
    setWakeOnLan(false);
    setWolDelay(30);
    setExecutionType('direct');
    onClose();
  }, [onClose]);

  const addCommand = useCallback(() => {
    setCommands((prev) => [
      ...prev,
      { id: Math.random().toString(36).substring(2, 10), command: '', arg: '' },
    ]);
  }, []);

  const removeCommand = useCallback((id: string) => {
    setCommands((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const updateCommand = useCallback((id: string, field: 'command' | 'arg', value: string) => {
    setCommands((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    );
  }, []);

  const commandString = useMemo(() => {
    // Sanitize argument: only allow safe characters (alphanumeric, spaces, dots, hyphens, underscores)
    const sanitizeArg = (arg: string) => arg.replace(/[^a-zA-Z0-9 ._-]/g, '');

    return commands
      .filter((c) => c.command)
      .map((c) => {
        const cmdDef = LINBO_COMMANDS.find((def) => def.value === c.command);
        if (cmdDef?.hasArg && c.arg) {
          return `${c.command}:${sanitizeArg(c.arg)}`;
        }
        return c.command;
      })
      .join(',');
  }, [commands]);

  const targetCount = useMemo(() => {
    switch (targetType) {
      case 'hosts':
        return selectedMacs.length;
      case 'hostgroup':
        return selectedHostgroup
          ? syncHosts.filter((h) => h.hostgroup === selectedHostgroup).length
          : 0;
      default:
        return 0;
    }
  }, [targetType, selectedMacs, selectedHostgroup, syncHosts]);

  const isValid = useMemo(() => {
    if (commands.length === 0) return false;
    if (commands.some((c) => !c.command)) return false;
    if (targetCount === 0) return false;
    return true;
  }, [commands, targetCount]);

  const handleSubmit = async () => {
    if (!isValid) return;

    setIsLoading(true);
    try {
      const baseData = {
        commands: commandString,
        options: {
          wakeOnLan,
          ...(wakeOnLan && { wolDelay }),
        },
      };

      let requestData: DirectCommandRequest | ScheduleCommandRequest;

      switch (targetType) {
        case 'hosts':
          requestData = { ...baseData, macs: selectedMacs };
          break;
        case 'hostgroup':
          requestData = { ...baseData, hostgroup: selectedHostgroup };
          break;
        default:
          requestData = { ...baseData, macs: selectedMacs };
      }

      if (executionType === 'direct') {
        await operationsApi.direct(requestData);
        notify.success(
          'Befehle gesendet',
          `${targetCount} Host(s) werden ausgefuehrt`
        );
      } else {
        const result = await operationsApi.schedule(requestData);
        notify.success(
          'Befehle geplant',
          `${result.scheduled} Host(s) fuer naechsten Boot`
        );
      }

      onSuccess();
      handleClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fehler bei der Ausfuehrung';
      notify.error('Fehler', message);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMacSelection = useCallback((mac: string) => {
    setSelectedMacs((prev) =>
      prev.includes(mac) ? prev.filter((m) => m !== mac) : [...prev, mac]
    );
  }, []);

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Remote-Befehl" size="xl">
      <div className="space-y-6">
        {/* Execution Type Toggle */}
        <div className="flex rounded-lg overflow-hidden border border-border">
          <button
            type="button"
            onClick={() => setExecutionType('direct')}
            className={`flex-1 py-2 px-4 text-sm font-medium flex items-center justify-center gap-2 ${
              executionType === 'direct'
                ? 'bg-primary text-white'
                : 'bg-card text-foreground hover:bg-muted/50'
            }`}
          >
            <Play className="h-4 w-4" />
            Sofort ausfuehren
          </button>
          <button
            type="button"
            onClick={() => setExecutionType('scheduled')}
            className={`flex-1 py-2 px-4 text-sm font-medium flex items-center justify-center gap-2 ${
              executionType === 'scheduled'
                ? 'bg-primary text-white'
                : 'bg-card text-foreground hover:bg-muted/50'
            }`}
          >
            <Clock className="h-4 w-4" />
            Bei naechstem Boot
          </button>
        </div>

        {/* Target Selection */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-foreground">Ziel auswaehlen</label>

          {/* Target Type Tabs */}
          <div className="flex rounded-lg overflow-hidden border border-border">
            <button
              type="button"
              onClick={() => setTargetType('hosts')}
              className={`flex-1 py-2 px-3 text-sm flex items-center justify-center gap-2 ${
                targetType === 'hosts'
                  ? 'bg-secondary font-medium'
                  : 'bg-card text-muted-foreground hover:bg-muted/50'
              }`}
            >
              <Monitor className="h-4 w-4" />
              Hosts
            </button>
            <button
              type="button"
              onClick={() => setTargetType('hostgroup')}
              className={`flex-1 py-2 px-3 text-sm flex items-center justify-center gap-2 ${
                targetType === 'hostgroup'
                  ? 'bg-secondary font-medium'
                  : 'bg-card text-muted-foreground hover:bg-muted/50'
              }`}
            >
              <Building2 className="h-4 w-4" />
              Hostgruppe
            </button>
          </div>

          {/* Target Selection Content */}
          {targetType === 'hosts' && (
            <div className="border border-border rounded-lg max-h-48 overflow-y-auto">
              {hostsLoading ? (
                <div className="p-4 text-center text-muted-foreground">Laden...</div>
              ) : syncHosts.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground">Keine Hosts vorhanden</div>
              ) : (
                <div className="divide-y divide-border">
                  {syncHosts.map((host) => (
                    <label
                      key={host.mac}
                      className="flex items-center px-4 py-2 hover:bg-muted/50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedMacs.includes(host.mac)}
                        onChange={() => toggleMacSelection(host.mac)}
                        className="rounded border-border text-primary focus:ring-ring"
                      />
                      <span className="ml-3 text-sm">
                        <span className="font-medium">{host.hostname}</span>
                        <span className="text-muted-foreground ml-2">
                          {host.ip || host.mac}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {targetType === 'hostgroup' && (
            <Select
              value={selectedHostgroup}
              onChange={(e) => setSelectedHostgroup(e.target.value)}
              options={[
                { value: '', label: 'Hostgruppe auswaehlen...' },
                ...hostgroups.map((g) => ({
                  value: g,
                  label: `${g} (${syncHosts.filter((h) => h.hostgroup === g).length} Hosts)`,
                })),
              ]}
            />
          )}

          <div className="text-sm text-muted-foreground">
            {targetCount} Host(s) ausgewaehlt
          </div>
        </div>

        {/* Command Builder */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-foreground">Befehle</label>
            <Button size="sm" variant="secondary" onClick={addCommand}>
              <Plus className="h-4 w-4 mr-1" />
              Befehl hinzufuegen
            </Button>
          </div>

          {commands.length === 0 ? (
            <div className="text-center py-6 border-2 border-dashed border-border rounded-lg">
              <p className="text-muted-foreground text-sm">Keine Befehle ausgewaehlt</p>
              <Button size="sm" variant="secondary" onClick={addCommand} className="mt-2">
                <Plus className="h-4 w-4 mr-1" />
                Befehl hinzufuegen
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {commands.map((cmd, idx) => {
                const cmdDef = LINBO_COMMANDS.find((c) => c.value === cmd.command);
                return (
                  <div key={cmd.id} className="flex items-start gap-2">
                    <span className="text-muted-foreground text-sm pt-2 w-6">{idx + 1}.</span>
                    <div className="flex-1">
                      <Select
                        value={cmd.command}
                        onChange={(e) => updateCommand(cmd.id, 'command', e.target.value)}
                        options={[
                          { value: '', label: 'Befehl auswaehlen...' },
                          ...LINBO_COMMANDS.map((c) => ({
                            value: c.value,
                            label: `${c.label} - ${c.description}`,
                          })),
                        ]}
                      />
                    </div>
                    {cmdDef?.hasArg && (
                      <div className="w-32">
                        {cmdDef.argOptions ? (
                          <Select
                            value={cmd.arg || ''}
                            onChange={(e) => updateCommand(cmd.id, 'arg', e.target.value)}
                            options={[
                              { value: '', label: cmdDef.argLabel || 'Argument' },
                              ...cmdDef.argOptions.map((opt) => ({
                                value: opt,
                                label: opt,
                              })),
                            ]}
                          />
                        ) : (
                          <Input
                            placeholder={cmdDef.argLabel || '#'}
                            value={cmd.arg || ''}
                            onChange={(e) => updateCommand(cmd.id, 'arg', e.target.value)}
                          />
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeCommand(cmd.id)}
                      className="p-2 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {commandString && (
            <div className="bg-secondary rounded p-3">
              <p className="text-xs text-muted-foreground mb-1">Befehlsstring:</p>
              <code className="text-sm font-mono text-foreground">{commandString}</code>
            </div>
          )}
        </div>

        {/* Options */}
        <div className="space-y-3 border-t border-border pt-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={wakeOnLan}
              onChange={(e) => setWakeOnLan(e.target.checked)}
              className="rounded border-border text-primary focus:ring-ring"
            />
            <span className="text-sm text-foreground">Wake-on-LAN vor Ausfuehrung senden</span>
          </label>

          {wakeOnLan && (
            <div className="ml-6">
              <Input
                type="number"
                label="Wartezeit nach WoL (Sekunden)"
                value={wolDelay}
                onChange={(e) => setWolDelay(parseInt(e.target.value) || 0)}
                min={0}
                max={300}
              />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-3 pt-4 border-t border-border">
          <Button variant="secondary" onClick={handleClose}>
            Abbrechen
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid} loading={isLoading}>
            {executionType === 'direct' ? 'Ausfuehren' : 'Planen'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
