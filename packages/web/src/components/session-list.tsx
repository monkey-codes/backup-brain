import { Plus } from "lucide-react";
import type { ChatSession } from "@backup-brain/shared";
import { Button } from "@/components/ui/button";
import {
  useSessions,
  useCreateSession,
  useCurrentSession,
} from "@/hooks/use-sessions";

function SessionItem({
  session,
  active,
  onClick,
}: {
  session: ChatSession;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      data-active={active}
      onClick={onClick}
      className={`w-full truncate rounded-md px-3 py-2 text-left text-sm transition-colors ${
        active
          ? "bg-accent text-accent-foreground"
          : "hover:bg-muted text-foreground"
      }`}
    >
      {session.title ?? "New chat"}
    </button>
  );
}

export function SessionList({
  onSessionSelect,
}: {
  onSessionSelect?: () => void;
}) {
  const { data: sessions, isLoading } = useSessions();
  const createSession = useCreateSession();
  const { currentSession, setCurrentSession } = useCurrentSession();

  const handleCreate = async () => {
    const newSession = await createSession.mutateAsync();
    setCurrentSession(newSession);
    onSessionSelect?.();
  };

  const handleSelect = (session: ChatSession) => {
    setCurrentSession(session);
    onSessionSelect?.();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={handleCreate}
          disabled={createSession.isPending}
          aria-label="New chat"
        >
          <Plus className="h-4 w-4" />
          New chat
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {isLoading && (
          <p className="px-3 py-2 text-sm text-muted-foreground">Loading...</p>
        )}
        {sessions?.map((session) => (
          <SessionItem
            key={session.id}
            session={session}
            active={currentSession?.id === session.id}
            onClick={() => handleSelect(session)}
          />
        ))}
        {!isLoading && sessions?.length === 0 && (
          <p className="px-3 py-2 text-sm text-muted-foreground">
            No conversations yet
          </p>
        )}
      </div>
    </div>
  );
}
