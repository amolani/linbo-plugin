import { Fragment } from 'react';
import { Transition } from '@headlessui/react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useNotificationStore, Notification } from '@/stores/notificationStore';

const icons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
};

const iconColors = {
  info: 'text-primary',
  success: 'text-ciGreen',
  warning: 'text-yellow-400',
  error: 'text-destructive',
};

function ToastItem({ notification }: { notification: Notification }) {
  const { removeNotification } = useNotificationStore();
  const Icon = icons[notification.type];

  return (
    <Transition
      appear
      show={true}
      as={Fragment}
      enter="transform ease-out duration-300 transition"
      enterFrom="translate-y-2 opacity-0 sm:translate-y-0 sm:translate-x-2"
      enterTo="translate-y-0 opacity-100 sm:translate-x-0"
      leave="transition ease-in duration-100"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
    >
      <div className="max-w-sm w-full bg-card border border-border shadow-lg rounded-lg pointer-events-auto overflow-hidden">
        <div className="p-4">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <Icon className={`h-5 w-5 ${iconColors[notification.type]}`} aria-hidden="true" />
            </div>
            <div className="ml-3 w-0 flex-1 pt-0.5">
              <p className="text-sm font-medium text-foreground">{notification.title}</p>
              {notification.message && (
                <p className="mt-1 text-sm text-muted-foreground">{notification.message}</p>
              )}
            </div>
            <div className="ml-4 flex-shrink-0 flex">
              <button
                className="rounded-md inline-flex text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                onClick={() => removeNotification(notification.id)}
              >
                <span className="sr-only">Schließen</span>
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  );
}

export function ToastContainer() {
  const { notifications } = useNotificationStore();

  return (
    <div
      aria-live="assertive"
      className="fixed inset-0 flex items-end px-4 py-6 pointer-events-none sm:p-6 sm:items-start z-50"
    >
      <div className="w-full flex flex-col items-center space-y-4 sm:items-end">
        {notifications.map((notification) => (
          <ToastItem key={notification.id} notification={notification} />
        ))}
      </div>
    </div>
  );
}
