import { useParams } from "react-router-dom";
import { ChatView } from "@/components/chat-view";

export function ChatPage() {
  const { sessionId } = useParams<{ sessionId: string }>();

  if (!sessionId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-on-surface-variant">
          Select a conversation or start a new one
        </p>
      </div>
    );
  }

  return <ChatView sessionId={sessionId} />;
}
