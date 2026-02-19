import React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { notificationsClient } from '@/api/notificationsClient';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function NotificationDropdown({ user }) {
  const queryClient = useQueryClient();

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications', user?.email],
    enabled: Boolean(user?.email),
    queryFn: () => notificationsClient.list(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const markAsReadMutation = useMutation({
    mutationFn: (notificationId) => notificationsClient.markRead(notificationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const unreadCount = notifications.filter((notification) => !notification.read).length;

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
        </div>

        <div className="max-h-96 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="py-8 text-center">
              <Bell className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No notifications yet</p>
            </div>
          ) : (
            notifications.map((notification) => (
              <DropdownMenuItem key={notification.id} className="p-0 cursor-pointer focus:bg-slate-50" asChild>
                <Link
                  to={notification.action_url || createPageUrl('Proposals')}
                  onClick={() => {
                    if (!notification.read) {
                      markAsReadMutation.mutate(notification.id);
                    }
                  }}
                  className="flex items-start gap-3 px-3 py-3 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${!notification.read ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>
                      {notification.title || 'Notification'}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                      {notification.message || ''}
                    </p>
                  </div>
                </Link>
              </DropdownMenuItem>
            ))
          )}
        </div>

        {notifications.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <div className="p-2">
              <Link to={createPageUrl('Proposals')}>
                <Button variant="ghost" className="w-full justify-center text-sm">
                  View proposals
                </Button>
              </Link>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
