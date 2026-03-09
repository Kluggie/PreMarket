import React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, X } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { notificationsClient } from '@/api/notificationsClient';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';

export default function NotificationDropdown({ user }) {
  const queryClient = useQueryClient();

  const { data: notifications = [], isError: notificationsError } = useQuery({
    queryKey: ['notifications', user?.email],
    enabled: Boolean(user?.email),
    queryFn: () => notificationsClient.list(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const markAsReadMutation = useMutation({
    mutationFn: (notificationId) => notificationsClient.markRead(notificationId),
    onMutate: async (notificationId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['notifications', user?.email] });

      // Snapshot the previous value
      const previousNotifications = queryClient.getQueryData(['notifications', user?.email]);

      // Optimistically update to the new value
      queryClient.setQueryData(['notifications', user?.email], (old) => {
        if (!old || !Array.isArray(old)) return old;
        return old.map((notification) =>
          notification.id === notificationId
            ? { ...notification, read: true, read_at: new Date().toISOString() }
            : notification
        );
      });

      // Return a context object with the snapshotted value
      return { previousNotifications };
    },
    onError: (err, notificationId, context) => {
      // Roll back to the previous value on error
      if (context?.previousNotifications) {
        queryClient.setQueryData(['notifications', user?.email], context.previousNotifications);
      }
      toast.error('Failed to mark notification as read');
    },
    onSuccess: () => {
      // Refetch to ensure we're in sync with server
      queryClient.refetchQueries({ queryKey: ['notifications', user?.email] });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: (notificationId) => notificationsClient.dismiss(notificationId),
    onMutate: async (notificationId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['notifications', user?.email] });

      // Snapshot the previous value
      const previousNotifications = queryClient.getQueryData(['notifications', user?.email]);

      // Optimistically remove the notification from the list
      queryClient.setQueryData(['notifications', user?.email], (old) => {
        if (!old || !Array.isArray(old)) return old;
        return old.filter((notification) => notification.id !== notificationId);
      });

      // Return a context object with the snapshotted value and notification
      const dismissedNotification = previousNotifications?.find((n) => n.id === notificationId);
      return { previousNotifications, dismissedNotification };
    },
    onError: (err, notificationId, context) => {
      // Roll back to the previous value on error
      if (context?.previousNotifications) {
        queryClient.setQueryData(['notifications', user?.email], context.previousNotifications);
      }
      toast.error('Failed to dismiss notification');
    },
    onSuccess: (data, notificationId, context) => {
      // Refetch to ensure we're in sync with server
      queryClient.refetchQueries({ queryKey: ['notifications', user?.email] });
      
      // Show a success toast with undo option
      const dismissedNotification = context?.dismissedNotification;
      if (dismissedNotification) {
        toast.success('Notification dismissed', {
          action: {
            label: 'Undo',
            onClick: () => {
              // Add back to the list optimistically
              queryClient.setQueryData(['notifications', user?.email], (old) => {
                if (!old || !Array.isArray(old)) return [dismissedNotification];
                return [dismissedNotification, ...old].sort(
                  (a, b) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime()
                );
              });
              // Note: In a production app, you'd need a backend endpoint to undo the dismissal
            },
          },
          duration: 5000,
        });
      }
    },
  });

  const unreadCount = notifications.filter((notification) => !notification.read && !notification.dismissed).length;
  
  // Show only the 7 most recent notifications
  const displayedNotifications = notifications.slice(0, 7);

  const handleMarkAsRead = (e, notificationId) => {
    e.preventDefault();
    e.stopPropagation();
    markAsReadMutation.mutate(notificationId);
  };

  const handleDismiss = (e, notificationId) => {
    e.preventDefault();
    e.stopPropagation();
    dismissMutation.mutate(notificationId);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="w-5 h-5 text-slate-600" />
          {unreadCount > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs bg-blue-600">
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
          <p className="text-sm font-semibold text-slate-900">Notifications</p>
          {unreadCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {unreadCount} new
            </Badge>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {displayedNotifications.length === 0 ? (
            <div className="py-8 text-center">
              <Bell className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              {notificationsError ? (
                <p className="text-sm text-amber-700">Could not load notifications</p>
              ) : (
                <p className="text-sm text-slate-500">No notifications yet</p>
              )}
            </div>
          ) : (
            displayedNotifications.map((notification) => (
              <div 
                key={notification.id} 
                className={`relative group ${!notification.read ? 'bg-blue-50/50' : ''}`}
              >
                <Link
                  to={notification.action_url || createPageUrl('Proposals')}
                  className={`block px-3 py-3 pr-10 hover:bg-slate-50 transition-colors ${!notification.read ? 'border-l-2 border-blue-500' : ''}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${!notification.read ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>
                      {notification.title || 'Notification'}
                    </p>
                    <p className={`text-xs mt-0.5 line-clamp-2 ${!notification.read ? 'text-slate-600' : 'text-slate-500'}`}>
                      {notification.message || ''}
                    </p>
                    {!notification.read && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs mt-1.5 hover:bg-blue-100"
                        onClick={(e) => handleMarkAsRead(e, notification.id)}
                      >
                        <Check className="w-3 h-3 mr-1" />
                        Mark as read
                      </Button>
                    )}
                  </div>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-slate-200"
                  onClick={(e) => handleDismiss(e, notification.id)}
                  title="Dismiss notification"
                >
                  <X className="w-4 h-4 text-slate-500" />
                </Button>
              </div>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
