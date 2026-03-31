import { useState } from "react";
import { Check, Pencil, Loader2, Trash2 } from "lucide-react";
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
      ? "bg-green-900/40 text-green-400"
      : confidence >= 0.4
        ? "bg-yellow-900/40 text-yellow-400"
        : "bg-red-900/40 text-red-400";
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
      ? "bg-green-900/40 text-green-400"
      : status === "corrected"
        ? "bg-primary/15 text-primary"
        : "bg-surface-container-highest text-on-surface-variant";
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
    <span className="font-label inline-block rounded-full bg-purple-900/40 px-2 py-0.5 text-xs uppercase tracking-widest text-purple-400">
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

const BORDER_COLOR: Record<string, string> = {
  pending: "border-l-purple-500",
  accepted: "border-l-primary",
  corrected: "border-l-primary",
};

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
          <label className="font-label w-24 text-xs uppercase tracking-widest text-on-surface-variant">
            {key}
          </label>
          <input
            data-testid={`correction-input-${key}`}
            type={key === "due_at" ? "datetime-local" : "text"}
            value={val}
            onChange={(e) => handleChange(key, e.target.value)}
            className="flex-1 rounded-lg bg-surface-container-lowest px-2 py-1 text-sm text-on-surface outline-none transition-colors focus:bg-surface-container-low focus:ring-2 focus:ring-primary/20"
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
        <Button size="sm" variant="secondary" onClick={onCancel}>
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
  onDiscard,
  isAccepting,
}: {
  decision: DecisionWithThought;
  onAccept: () => void;
  onCorrect: (value: Record<string, string>) => void;
  onDiscard: () => void;
  isAccepting: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [correctPending, setCorrectPending] = useState(false);

  const borderColor =
    BORDER_COLOR[decision.review_status] ?? "border-l-purple-500";

  return (
    <div
      data-testid="decision-card"
      className={`rounded-lg border-l-4 ${borderColor} bg-surface-container-low p-4`}
    >
      {/* Thought context — quoted block */}
      {decision.thought && (
        <div
          data-testid="thought-content"
          className="mb-3 rounded-lg bg-surface-container-lowest px-3 py-2"
        >
          <p className="text-sm text-on-surface-variant">
            {decision.thought.content}
          </p>
        </div>
      )}

      {/* Decision details */}
      <div className="flex flex-wrap items-center gap-2">
        {typeBadge(decision.decision_type)}
        <span className="text-sm font-medium text-on-surface">
          {formatValue(decision.decision_type, decision.value)}
        </span>
        {confidenceBadge(decision.confidence)}
        {statusBadge(decision.review_status)}
      </div>

      {decision.reasoning && (
        <p className="mt-2 text-xs text-on-surface-variant">
          {decision.reasoning}
        </p>
      )}

      {decision.corrected_value && (
        <p className="mt-2 text-xs text-primary">
          Corrected to:{" "}
          {formatValue(decision.decision_type, decision.corrected_value)}
        </p>
      )}

      {/* Actions */}
      {decision.review_status === "pending" && !editing && (
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
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
            variant="secondary"
            onClick={() => setEditing(true)}
            data-testid="correct-button"
          >
            <Pencil className="mr-1 h-3 w-3" />
            Correct
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={onDiscard}
            data-testid="discard-button"
          >
            <Trash2 className="mr-1 h-3 w-3" />
            Discard
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
      {/* Segmented filter control */}
      <div className="px-4 py-3">
        <div className="mx-auto flex max-w-2xl">
          <div className="inline-flex rounded-lg bg-surface-container-high p-1">
            <button
              onClick={() => setFilter("needs_review")}
              data-testid="filter-needs-review"
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                filter === "needs_review"
                  ? "bg-surface-container-lowest text-on-surface"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              Needs Review
            </button>
            <button
              onClick={() => setFilter("all")}
              data-testid="filter-all"
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                filter === "all"
                  ? "bg-surface-container-lowest text-on-surface"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              All
            </button>
          </div>
        </div>
      </div>

      {/* Decision list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {isLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-on-surface-variant" />
            </div>
          )}
          {!isLoading && decisions?.length === 0 && (
            <p
              data-testid="empty-state"
              className="py-8 text-center text-on-surface-variant"
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
              onDiscard={() => acceptMutation.mutate(decision.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
