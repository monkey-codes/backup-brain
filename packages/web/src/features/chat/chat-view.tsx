import { useState, useRef, useEffect, useMemo, type FormEvent } from "react";
import { Send } from "lucide-react";
import type { ChatMessage } from "@backup-brain/shared";
import { Button } from "@/shared/ui/button";
import {
  useMessages,
  useSendMessage,
  useIsThinking,
} from "@/features/chat/use-messages";

function formatMessageTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor(
    (today.getTime() - msgDay.getTime()) / 86_400_000
  );

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: "long" });
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getDateKey(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Group messages by date, inserting divider labels. */
function groupMessagesWithDividers(
  messages: ChatMessage[]
): Array<
  { type: "divider"; label: string } | { type: "message"; message: ChatMessage }
> {
  const items: Array<
    | { type: "divider"; label: string }
    | { type: "message"; message: ChatMessage }
  > = [];
  let lastDateKey = "";
  for (const msg of messages) {
    const key = getDateKey(msg.created_at);
    if (key !== lastDateKey) {
      items.push({ type: "divider", label: formatDateLabel(msg.created_at) });
      lastDateKey = key;
    }
    items.push({ type: "message", message: msg });
  }
  return items;
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div
      data-testid="chat-message"
      data-role={message.role}
      className={`flex flex-col gap-1 max-w-[85%] ${
        isUser ? "items-end self-end" : "items-start"
      }`}
    >
      <div
        className={`p-4 rounded-xl text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? "bg-secondary-container text-on-secondary-container rounded-tr-none"
            : "bg-surface-container-low text-on-surface rounded-tl-none border-l-2 border-primary/20"
        }`}
      >
        {message.content}
      </div>
      <span
        className={`text-[10px] text-on-surface-variant ${
          isUser ? "mr-1" : "ml-1"
        }`}
      >
        {formatMessageTime(message.created_at)}
      </span>
    </div>
  );
}

function DateDivider({ label }: { label: string }) {
  return (
    <div data-testid="date-divider" className="flex justify-center">
      <span className="bg-surface-container px-3 py-1 rounded-full text-[10px] text-on-surface-variant font-medium uppercase tracking-widest">
        {label}
      </span>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div
      data-testid="thinking-indicator"
      className="flex flex-col items-start max-w-[85%]"
    >
      <div className="bg-surface-container-low text-on-surface px-4 py-3 rounded-xl rounded-tl-none flex items-center gap-3">
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
          <div className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-pulse [animation-delay:200ms]" />
          <div className="w-1.5 h-1.5 bg-primary/30 rounded-full animate-pulse [animation-delay:400ms]" />
        </div>
        <span className="text-xs font-medium text-on-surface-variant italic">
          Thinking...
        </span>
      </div>
    </div>
  );
}

export function ChatView({ sessionId }: { sessionId: string }) {
  const { data: messages } = useMessages(sessionId);
  const sendMessage = useSendMessage(sessionId);
  const isThinking = useIsThinking(messages);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const groupedItems = useMemo(
    () => (messages ? groupMessagesWithDividers(messages) : []),
    [messages]
  );

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, [sessionId]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || sendMessage.isPending) return;
    sendMessage.mutate(trimmed);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {groupedItems.map((item, i) =>
            item.type === "divider" ? (
              <DateDivider key={`divider-${i}`} label={item.label} />
            ) : (
              <MessageBubble key={item.message.id} message={item.message} />
            )
          )}
          {isThinking && <ThinkingIndicator />}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Glassmorphic input bar */}
      <div
        className="p-4 backdrop-blur-xl"
        style={{ backgroundColor: "rgba(17, 19, 25, 0.6)" }}
      >
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-2xl items-end gap-3"
        >
          <div className="flex-1 bg-surface-container-lowest rounded-xl min-h-[48px] flex items-center px-4 transition-all focus-within:bg-surface-container-low focus-within:ring-1 focus-within:ring-primary/20">
            <textarea
              ref={inputRef}
              data-testid="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Backup Brain..."
              rows={1}
              className="w-full bg-transparent resize-none text-sm text-on-surface py-3 outline-none placeholder:text-outline max-h-32"
            />
          </div>
          <Button
            type="submit"
            size="icon"
            className="h-12 w-12 rounded-xl shadow-lg shadow-primary/20"
            disabled={!input.trim() || sendMessage.isPending}
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
