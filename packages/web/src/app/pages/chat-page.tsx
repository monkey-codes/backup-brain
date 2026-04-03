import { useCurrentSession } from "@/hooks/use-sessions";
import { ChatView } from "@/components/chat-view";

export function ChatPage() {
  const { currentSession } = useCurrentSession();

  if (!currentSession) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-on-surface-variant">
          Select a conversation or start a new one
        </p>
      </div>
    );
  }

  return <ChatView sessionId={currentSession.id} />;
}
