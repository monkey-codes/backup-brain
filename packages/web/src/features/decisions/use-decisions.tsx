import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ThoughtDecision, ReviewStatus } from "@backup-brain/shared";
import { supabase } from "@/shared/lib/supabase";

export type DecisionFilter = "needs_review" | "all";

export interface DecisionWithThought extends ThoughtDecision {
  thought: { id: string; content: string } | null;
}

const DECISIONS_KEY = "thought_decisions";

function decisionsKey(filter: DecisionFilter) {
  return [DECISIONS_KEY, filter];
}

export function useDecisions(filter: DecisionFilter) {
  return useQuery<DecisionWithThought[]>({
    queryKey: decisionsKey(filter),
    queryFn: async () => {
      let query = supabase
        .from("thought_decisions")
        .select("*, thought:thoughts(id, content)");

      if (filter === "needs_review") {
        query = query.or("review_status.eq.pending,confidence.lt.0.7");
      }

      const { data, error } = await query.order("created_at", {
        ascending: false,
      });
      if (error) throw error;
      return data as DecisionWithThought[];
    },
  });
}

export function useAcceptDecision() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (decisionId: string) => {
      const { data, error } = await supabase
        .from("thought_decisions")
        .update({ review_status: "accepted" as ReviewStatus })
        .eq("id", decisionId)
        .select()
        .single();

      if (error) throw error;
      return data as ThoughtDecision;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [DECISIONS_KEY] });
    },
  });
}

export function useCorrectDecision() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      decisionId,
      correctedValue,
      userId,
    }: {
      decisionId: string;
      correctedValue: Record<string, string>;
      userId: string;
    }) => {
      const { data, error } = await supabase
        .from("thought_decisions")
        .update({
          review_status: "corrected" as ReviewStatus,
          corrected_value: correctedValue,
          corrected_by: userId,
          corrected_at: new Date().toISOString(),
        })
        .eq("id", decisionId)
        .select()
        .single();

      if (error) throw error;
      return data as ThoughtDecision;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [DECISIONS_KEY] });
    },
  });
}
