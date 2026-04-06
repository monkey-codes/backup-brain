import { useQuery } from "@tanstack/react-query";
import type { ReminderValue, ReviewStatus } from "@backup-brain/shared";
import { supabase } from "@/shared/lib/supabase";

export interface Reminder {
  id: string;
  due_at: string;
  description: string;
  review_status: ReviewStatus;
}

export type RemindersByDay = Record<string, Reminder[]>;

interface ReminderRow {
  id: string;
  value: ReminderValue;
  review_status: ReviewStatus;
  corrected_value: ReminderValue | null;
}

export function useReminders(year: number, month: number) {
  return useQuery<RemindersByDay>({
    queryKey: ["reminders", year, month],
    queryFn: async () => {
      const start = new Date(Date.UTC(year, month - 1, 1));
      const end = new Date(Date.UTC(year, month, 1));

      const { data, error } = await supabase
        .from("thought_decisions")
        .select("*")
        .eq("decision_type", "reminder")
        .gte("value->>due_at", start.toISOString())
        .lt("value->>due_at", end.toISOString());

      if (error) throw error;

      const rows = data as ReminderRow[];
      const grouped: RemindersByDay = {};

      for (const row of rows) {
        const effective =
          row.review_status === "corrected" && row.corrected_value
            ? row.corrected_value
            : row.value;

        const dueAt = effective.due_at;
        const dayKey = dueAt.slice(0, 10); // "YYYY-MM-DD"

        const reminder: Reminder = {
          id: row.id,
          due_at: dueAt,
          description: effective.description,
          review_status: row.review_status,
        };

        if (!grouped[dayKey]) {
          grouped[dayKey] = [];
        }
        grouped[dayKey].push(reminder);
      }

      return grouped;
    },
  });
}
