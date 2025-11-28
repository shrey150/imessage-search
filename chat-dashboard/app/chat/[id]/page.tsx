"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { MessageSquare, Send, Loader2 } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
} from "@/components/ai-elements/message";
import { ChatMessage } from "@/components/chat-message";
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import {
  type ChatMessageData,
  getChat,
  updateChat,
  createChat,
} from "@/lib/chat-history";

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const chatId = params.id as string;
  
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const currentChatId = useRef<string>(chatId);
  const hasCreatedChat = useRef(false);

  // Example prompts
  const examplePrompts = [
    "What conversations have I had about dinner plans?",
    "Find messages from last month",
    "Search for photos I've received",
    "What did my group chats discuss this week?",
  ];

  // Load chat from localStorage on mount
  useEffect(() => {
    if (chatId === "new") {
      // Prevent double creation in React Strict Mode
      if (hasCreatedChat.current) return;
      hasCreatedChat.current = true;
      
      // Create a new chat and redirect to it
      const newChat = createChat();
      currentChatId.current = newChat.id;
      router.replace(`/chat/${newChat.id}`);
      setIsInitialized(true);
    } else {
      // Reset the flag when viewing an existing chat so "New Chat" works again
      hasCreatedChat.current = false;
      
      // Load existing chat
      const chat = getChat(chatId);
      if (chat) {
        setMessages(chat.messages);
        currentChatId.current = chat.id;
      } else {
        // Chat not found, redirect to new
        router.replace("/chat/new");
      }
      setIsInitialized(true);
    }
  }, [chatId, router]);

  // Save messages to localStorage whenever they change
  useEffect(() => {
    if (isInitialized && currentChatId.current && currentChatId.current !== "new") {
      updateChat(currentChatId.current, messages);
    }
  }, [messages, isInitialized]);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessageData = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("No response body");
      }

      let assistantContent = "";
      const assistantId = (Date.now() + 1).toString();

      // Add initial assistant message
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "" },
      ]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        assistantContent += chunk;

        // Update the assistant message with streamed content
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: assistantContent } : m
          )
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, messages]);

  // Focus input on mount
  useEffect(() => {
    if (isInitialized) {
      inputRef.current?.focus();
    }
  }, [isInitialized]);

  // Show loading state while initializing
  if (!isInitialized) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-3 px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <MessageSquare className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-semibold text-foreground">iMessage Search</h1>
            <p className="text-xs text-muted-foreground">
              AI-powered search for your messages
            </p>
          </div>
        </div>
      </header>

      {/* Chat Area */}
      <Conversation className="flex-1">
        <ConversationContent className="mx-auto max-w-4xl pb-32">
          {messages.length === 0 ? (
            <ConversationEmptyState
              title="Search your iMessages"
              description="Ask me anything about your message history. I can search by content, person, date, or even find photos."
              icon={<MessageSquare className="h-12 w-12" />}
            >
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {examplePrompts.map((prompt, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => setInput(prompt)}
                  >
                    {prompt}
                  </Button>
                ))}
              </div>
            </ConversationEmptyState>
          ) : (
            messages.map((message) => (
              <Message key={message.id} from={message.role}>
                <MessageContent>
                  {/* User messages */}
                  {message.role === "user" && (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  )}

                  {/* Assistant messages */}
                  {message.role === "assistant" && (
                    <>
                      {/* Tool calls if any */}
                      {message.toolCalls?.map((tool, i) => (
                        <Tool key={i} defaultOpen={false}>
                          <ToolHeader
                            title={
                              tool.toolName === "search_messages"
                                ? "Searching messages..."
                                : "Filtering messages..."
                            }
                            type="tool-invocation"
                            state={
                              tool.state === "result"
                                ? "output-available"
                                : "input-available"
                            }
                          />
                          <ToolContent>
                            <ToolInput input={tool.args} />
                            {tool.result && (
                              <ToolOutput output={tool.result} errorText={undefined} />
                            )}
                          </ToolContent>
                        </Tool>
                      ))}

                      {/* Text content */}
                      {message.content && (
                        <ChatMessage>{message.content}</ChatMessage>
                      )}
                    </>
                  )}
                </MessageContent>
              </Message>
            ))
          )}

          {/* Loading indicator */}
          {isLoading && messages[messages.length - 1]?.role === "user" && (
            <Message from="assistant">
              <MessageContent>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Searching your messages...</span>
                </div>
              </MessageContent>
            </Message>
          )}

          {/* Error message */}
          {error && (
            <div className="mx-4 rounded-lg bg-destructive/10 p-4 text-destructive">
              <p className="text-sm">Error: {error}</p>
            </div>
          )}
        </ConversationContent>

        <ConversationScrollButton />
      </Conversation>

      {/* Input Area */}
      <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-t from-background via-background to-transparent pb-4 pt-8">
        <div className="mx-auto max-w-4xl px-4">
          <form
            ref={formRef}
            onSubmit={handleSubmit}
            className="flex items-center gap-2 rounded-xl border border-border bg-card p-2 shadow-lg"
          >
            <input
              ref={inputRef}
              type="text"
              name="message"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your messages..."
              className="flex-1 bg-transparent px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none"
              autoComplete="off"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || isLoading}
              className="h-9 w-9 shrink-0"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Press Enter to send
          </p>
        </div>
      </div>
    </div>
  );
}

