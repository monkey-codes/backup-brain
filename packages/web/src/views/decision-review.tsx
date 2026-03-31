import { useState } from "react";
import { Check, Pencil, ArrowLeft, Loader2 } from "lucide-react";
import type { DecisionType, DecisionValue } from "@backup-brain/shared";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import {
  useDecisions,
  useAcceptDecision,
  useCorrectDecision,
  type DecisionFilter,
  type DecisionWithThought,
} from "@/hooks/use-decisions";

function formatValue(type: DecisionType, value: DecisionValue): string {
  switch (type) {
    case "classification":
      return (value as { category: string }).category;
    case "entity":
      return `${(value as { name: string }).name} (${(value as { type: string }).type})`;
    case "reminder":
      return (value as { description: string }).description;
    case "tag":
      return (value as { label: string }).label;
    default:
      return JSON.stringify(value);
  }
}

function confidenceBadge(confidence: number) {
  const pct = Math.round(confidence * 100);
  const color =
    confidence >= 0.7
      ? "bg-green-100 text-green-800"
      : confidence >= 0.4
        ? "bg-yellow-100 text-yellow-800"
        : "bg-red-100 text-red-800";
  return (
    <span
      data-testid="confidence-badge"
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${color}`}
    >
      {pct}%
    </span>
  );
}

function statusBadge(status: string) {
  const color =
    status === "accepted"
      ? "bg-green-100 text-green-800"
      : status === "corrected"
        ? "bg-blue-100 text-blue-800"
        : "bg-gray-100 text-gray-800";
  return (
    <span
      data-testid="status-badge"
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${color}`}
    >
      {status}
    </span>
  );
}

function typeBadge(type: DecisionType) {
  return (
    <span className="inline-block rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium capitalize text-purple-800">
      {type}
    </span>
  );
}

function extractFormFields(
  type: DecisionType,
  value: DecisionValue
): Record<string, string> {
  const v = value as unknown as Record<string, string>;
  switch (type) {
    case "classification":
      return { category: v.category };
    case "entity":
      return { name: v.name, type: v.type };
    case "reminder":
      return { description: v.description, due_at: v.due_at };
    case "tag":
      return { label: v.label };
    default:
      return {};
  }
}

function CorrectionForm({
  decision,
  onSubmit,
  onCancel,
  isPending,
}: {
  decision: DecisionWithThought;
  onSubmit: (value: Record<string, string>) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [formValue, setFormValue] = useState<Record<string, string>>(() =>
    extractFormFields(decision.decision_type, decision.value)
  );

  const handleChange = (key: string, val: string) => {
    setFormValue((prev) => ({ ...prev, [key]: val }));
  };

  return (
    <div data-testid="correction-form" className="mt-3 space-y-2">
      {Object.entries(formValue).map(([key, val]) => (
        <div key={key} className="flex items-center gap-2">
          <label className="w-24 text-xs font-medium capitalize text-muted-foreground">
            {key}
          </label>
          <input
            data-testid={`correction-input-${key}`}
            type={key === "due_at" ? "datetime-local" : "text"}
            value={val}
            onChange={(e) => handleChange(key, e.target.value)}
            className="flex-1 rounded-md border px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => onSubmit(formValue)}
          disabled={isPending}
          data-testid="correction-submit"
        >
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function DecisionCard({
  decision,
  onAccept,
  onCorrect,
  isAccepting,
}: {
  decision: DecisionWithThought;
  onAccept: () => void;
  onCorrect: (value: Record<string, string>) => void;
  isAccepting: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [correctPending, setCorrectPending] = useState(false);

  return (
    <div
      data-testid="decision-card"
      className="rounded-lg border bg-card p-4 shadow-sm"
    >
      {/* Thought context */}
      {decision.thought && (
        <p
          data-testid="thought-content"
          className="mb-2 text-sm text-muted-foreground"
        >
          {decision.thought.content}
        </p>
      )}

      {/* Decision details */}
      <div className="flex flex-wrap items-center gap-2">
        {typeBadge(decision.decision_type)}
        <span className="text-sm font-medium">
          {formatValue(decision.decision_type, decision.value)}
        </span>
        {confidenceBadge(decision.confidence)}
        {statusBadge(decision.review_status)}
      </div>

      {decision.reasoning && (
        <p className="mt-1 text-xs text-muted-foreground">
          {decision.reasoning}
        </p>
      )}

      {decision.corrected_value && (
        <p className="mt-1 text-xs text-blue-600">
          Corrected to:{" "}
          {formatValue(decision.decision_type, decision.corrected_value)}
        </p>
      )}

      {/* Actions */}
      {decision.review_status === "pending" && !editing && (
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onAccept}
            disabled={isAccepting}
            data-testid="accept-button"
          >
            {isAccepting ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Check className="mr-1 h-3 w-3" />
            )}
            Accept
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditing(true)}
            data-testid="correct-button"
          >
            <Pencil className="mr-1 h-3 w-3" />
            Correct
          </Button>
        </div>
      )}

      {editing && (
        <CorrectionForm
          decision={decision}
          isPending={correctPending}
          onSubmit={(value) => {
            setCorrectPending(true);
            onCorrect(value);
          }}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}

export function DecisionReviewView({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const [filter, setFilter] = useState<DecisionFilter>("needs_review");
  const { data: decisions, isLoading } = useDecisions(filter);
  const acceptMutation = useAcceptDecision();
  const correctMutation = useCorrectDecision();

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <div className="border-b px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            aria-label="Back to chat"
            data-testid="back-button"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h2 className="text-lg font-semibold">Decision Review</h2>
        </div>
      </div>

      {/* Filters */}
      <div className="border-b px-4 py-2">
        <div className="mx-auto flex max-w-2xl gap-2">
          <Button
            size="sm"
            variant={filter === "needs_review" ? "default" : "outline"}
            onClick={() => setFilter("needs_review")}
            data-testid="filter-needs-review"
          >
            Needs Review
          </Button>
          <Button
            size="sm"
            variant={filter === "all" ? "default" : "outline"}
            onClick={() => setFilter("all")}
            data-testid="filter-all"
          >
            All
          </Button>
        </div>
      </div>

      {/* Decision list */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {isLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {!isLoading && decisions?.length === 0 && (
            <p
              data-testid="empty-state"
              className="py-8 text-center text-muted-foreground"
            >
              {filter === "needs_review"
                ? "No decisions need review"
                : "No decisions yet"}
            </p>
          )}
          {decisions?.map((decision) => (
            <DecisionCard
              key={decision.id}
              decision={decision}
              isAccepting={
                acceptMutation.isPending &&
                acceptMutation.variables === decision.id
              }
              onAccept={() => acceptMutation.mutate(decision.id)}
              onCorrect={(value) =>
                correctMutation.mutate({
                  decisionId: decision.id,
                  correctedValue: value,
                  userId: user!.id,
                })
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}
