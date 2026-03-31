import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Notification } from "@backup-brain/shared";
import { supabase } from "@/lib/supabase";

const NOTIFICATIONS_KEY = "notifications";

export function useNotifications() {
  const queryClient = useQueryClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const query = useQuery<Notification[]>({
    queryKey: [NOTIFICATIONS_KEY],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .is("dismissed_at", null)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Notification[];
    },
  });

  // Realtime subscription for new notifications
  useEffect(() => {
    const channel = supabase
      .channel("notifications-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
        },
        (payload) => {
          const newNotification = payload.new as Notification;
          queryClient.setQueryData<Notification[]>(
            [NOTIFICATIONS_KEY],
            (old) => {
              if (!old) return [newNotification];
              if (old.some((n) => n.id === newNotification.id)) return old;
              return [newNotification, ...old];
            }
          );
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [queryClient]);

  return query;
}

export function useUnreadCount(
  notifications: Notification[] | undefined
): number {
  if (!notifications) return 0;
  return notifications.filter((n) => n.read_at === null).length;
}

export function useDismissNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (notificationId: string) => {
      const { data, error } = await supabase
        .from("notifications")
        .update({ dismissed_at: new Date().toISOString() })
        .eq("id", notificationId)
        .select()
        .single();

      if (error) throw error;
      return data as Notification;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [NOTIFICATIONS_KEY] });
    },
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (notificationId: string) => {
      const { data, error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", notificationId)
        .select()
        .single();

      if (error) throw error;
      return data as Notification;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [NOTIFICATIONS_KEY] });
    },
  });
}
