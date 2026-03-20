import { Fragment, useState } from 'react';
import { Menu, Transition } from '@headlessui/react';
import {
  MoreHorizontal,
  Wifi,
  RefreshCw,
  Play,
  RotateCcw,
  Power,
  Loader2,
  HardDrive,
} from 'lucide-react';
import type { SyncHost } from '@/api/sync';
import { useSyncHostActions } from '@/hooks/useSyncHostActions';
import { ConfirmModal } from '@/components/ui';
import { driversApi } from '@/api/drivers';
import { notify } from '@/stores/notificationStore';

interface QuickActionsDropdownProps {
  host: SyncHost;
  onActionComplete?: () => void;
}

type ConfirmAction = {
  type: 'reboot' | 'halt';
  host: SyncHost;
} | null;

function ActionButton({
  active,
  disabled,
  destructive,
  loading,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  destructive?: boolean;
  loading: boolean;
  icon: typeof Wifi;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2
        ${active ? 'bg-muted/50' : ''}
        ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
        ${destructive && !disabled ? 'text-destructive' : ''}
      `}
      onClick={onClick}
      disabled={disabled}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Icon className="h-4 w-4" />
      )}
      {label}
    </button>
  );
}

export function QuickActionsDropdown({ host, onActionComplete }: QuickActionsDropdownProps) {
  const actions = useSyncHostActions({ onActionComplete });
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  const isOffline = host.runtimeStatus === 'offline';

  const handleCreateDriverProfile = async () => {
    if (!host.ip) return;
    setIsCreatingProfile(true);
    try {
      const result = await driversApi.createProfile(host.ip);
      if (result.created) {
        notify.success(
          'Treiber-Profil erstellt',
          `Ordner "${result.folder}" fuer ${result.vendor} / ${result.product}`
        );
      } else {
        notify.info(
          'Treiber-Profil existiert bereits',
          `Ordner "${result.folder}" fuer ${result.vendor} / ${result.product}`
        );
      }
      onActionComplete?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Profil konnte nicht erstellt werden';
      notify.error('Treiber-Profil Fehler', message);
    } finally {
      setIsCreatingProfile(false);
    }
  };

  const handleConfirm = async () => {
    if (!confirmAction) return;
    if (confirmAction.type === 'reboot') {
      await actions.rebootHost(confirmAction.host);
    } else {
      await actions.haltHost(confirmAction.host);
    }
    setConfirmAction(null);
  };

  return (
    <>
      <Menu as="div" className="relative inline-block text-left">
        <Menu.Button className="p-1.5 rounded-md hover:bg-muted/50 transition-colors">
          <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
        </Menu.Button>

        <Transition
          as={Fragment}
          enter="transition ease-out duration-100"
          enterFrom="transform opacity-0 scale-95"
          enterTo="transform opacity-100 scale-100"
          leave="transition ease-in duration-75"
          leaveFrom="transform opacity-100 scale-100"
          leaveTo="transform opacity-0 scale-95"
        >
          <Menu.Items className="absolute right-0 mt-1 w-48 origin-top-right bg-card border border-border rounded-md shadow-lg z-50 py-1">
            {/* WoL -- always enabled */}
            <Menu.Item>
              {({ active, disabled }) => (
                <ActionButton
                  active={active}
                  disabled={disabled}
                  loading={actions.isLoading(host.hostname, 'wake')}
                  icon={Wifi}
                  label="Wake-on-LAN"
                  onClick={() => actions.wakeHost(host)}
                />
              )}
            </Menu.Item>

            {/* Sync -- disabled={isOffline} */}
            <Menu.Item disabled={isOffline}>
              {({ active, disabled }) => (
                <ActionButton
                  active={active}
                  disabled={disabled}
                  loading={actions.isLoading(host.hostname, 'sync')}
                  icon={RefreshCw}
                  label="Sync"
                  onClick={() => actions.syncHost(host)}
                />
              )}
            </Menu.Item>

            {/* Start -- disabled={isOffline} */}
            <Menu.Item disabled={isOffline}>
              {({ active, disabled }) => (
                <ActionButton
                  active={active}
                  disabled={disabled}
                  loading={actions.isLoading(host.hostname, 'start')}
                  icon={Play}
                  label="Start"
                  onClick={() => actions.startHost(host)}
                />
              )}
            </Menu.Item>

            {/* Reboot -- disabled={isOffline}, confirmation required */}
            <Menu.Item disabled={isOffline}>
              {({ active, disabled }) => (
                <ActionButton
                  active={active}
                  disabled={disabled}
                  loading={actions.isLoading(host.hostname, 'reboot')}
                  icon={RotateCcw}
                  label="Neu starten"
                  onClick={() => setConfirmAction({ type: 'reboot', host })}
                />
              )}
            </Menu.Item>

            {/* Halt -- disabled={isOffline}, confirmation required, destructive */}
            <Menu.Item disabled={isOffline}>
              {({ active, disabled }) => (
                <ActionButton
                  active={active}
                  disabled={disabled}
                  destructive
                  loading={actions.isLoading(host.hostname, 'halt')}
                  icon={Power}
                  label="Herunterfahren"
                  onClick={() => setConfirmAction({ type: 'halt', host })}
                />
              )}
            </Menu.Item>

            {/* Divider */}
            <div className="border-t border-border my-1" />

            {/* Treiber-Profil erstellen */}
            <Menu.Item disabled={isOffline || !host.ip}>
              {({ active, disabled }) => (
                <ActionButton
                  active={active}
                  disabled={disabled}
                  loading={isCreatingProfile}
                  icon={HardDrive}
                  label="Treiber-Profil"
                  onClick={handleCreateDriverProfile}
                />
              )}
            </Menu.Item>
          </Menu.Items>
        </Transition>
      </Menu>

      <ConfirmModal
        isOpen={confirmAction?.type === 'reboot'}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleConfirm}
        title="Neustart"
        message={`"${host.hostname}" wirklich neu starten?`}
        confirmLabel="Neu starten"
        variant="warning"
        loading={actions.isLoading(host.hostname, 'reboot')}
      />

      <ConfirmModal
        isOpen={confirmAction?.type === 'halt'}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleConfirm}
        title="Herunterfahren"
        message={`"${host.hostname}" wirklich herunterfahren?`}
        confirmLabel="Herunterfahren"
        variant="danger"
        loading={actions.isLoading(host.hostname, 'halt')}
      />
    </>
  );
}
