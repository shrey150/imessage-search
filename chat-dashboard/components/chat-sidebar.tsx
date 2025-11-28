"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  PanelLeftClose,
  PanelLeft,
  Plus,
  MessageSquare,
  Trash2,
  Search,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type ChatSession,
  listChats,
  deleteChat,
  formatRelativeTime,
} from "@/lib/chat-history";
import { Button } from "@/components/ui/button";

interface ChatSidebarProps {
  children: React.ReactNode;
}

export function ChatSidebar({ children }: ChatSidebarProps) {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [hoveredChat, setHoveredChat] = useState<string | null>(null);

  // Load chats from localStorage
  const loadChats = useCallback(() => {
    setChats(listChats());
  }, []);

  useEffect(() => {
    loadChats();
    // Refresh chat list when pathname changes (new chat created, etc.)
    const interval = setInterval(loadChats, 1000);
    return () => clearInterval(interval);
  }, [pathname, loadChats]);

  const handleDeleteChat = (e: React.MouseEvent, chatId: string) => {
    e.preventDefault();
    e.stopPropagation();
    deleteChat(chatId);
    loadChats();
  };

  // Get current chat ID from pathname
  const currentChatId = pathname.startsWith("/chat/")
    ? pathname.split("/chat/")[1]
    : null;

  // Check if we're on a chat page
  const isOnChatPage = pathname.startsWith("/chat");
  const isOnSearchPage = pathname === "/search";

  // Get the link for the Agent button - most recent chat or new
  const agentLink = chats.length > 0 ? `/chat/${chats[0].id}` : "/chat/new";

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 h-full bg-[#171717] border-r border-white/10 transition-all duration-300 flex flex-col",
          isCollapsed ? "w-0 overflow-hidden" : "w-64"
        )}
      >
        {/* Sidebar Header */}
        <div className="flex h-14 items-center justify-between px-3 border-b border-white/10">
          <Link
            href="/chat/new"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white/90 hover:bg-white/10 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Chat
          </Link>
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation Links */}
        <div className="px-2 py-3 border-b border-white/10">
          <Link
            href={agentLink}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isOnChatPage && !isOnSearchPage
                ? "bg-white/10 text-white"
                : "text-white/70 hover:text-white hover:bg-white/5"
            )}
          >
            <Sparkles className="h-4 w-4" />
            Agent
          </Link>
          <Link
            href="/search"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isOnSearchPage
                ? "bg-white/10 text-white"
                : "text-white/70 hover:text-white hover:bg-white/5"
            )}
          >
            <Search className="h-4 w-4" />
            Spotlight
          </Link>
        </div>

        {/* Chat History */}
        <div className="flex-1 overflow-y-auto px-2 py-3">
          <div className="mb-2 px-3 text-xs font-medium text-white/40 uppercase tracking-wider">
            Recent Chats
          </div>
          {chats.length === 0 ? (
            <div className="px-3 py-4 text-sm text-white/40 text-center">
              No chat history yet
            </div>
          ) : (
            <div className="space-y-1">
              {chats.map((chat) => (
                <Link
                  key={chat.id}
                  href={`/chat/${chat.id}`}
                  onMouseEnter={() => setHoveredChat(chat.id)}
                  onMouseLeave={() => setHoveredChat(null)}
                  className={cn(
                    "group flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors relative",
                    currentChatId === chat.id
                      ? "bg-white/10 text-white"
                      : "text-white/70 hover:text-white hover:bg-white/5"
                  )}
                >
                  <MessageSquare className="h-4 w-4 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{chat.title}</div>
                    <div className="text-xs text-white/40">
                      {formatRelativeTime(chat.updatedAt)}
                    </div>
                  </div>
                  {hoveredChat === chat.id && (
                    <button
                      onClick={(e) => handleDeleteChat(e, chat.id)}
                      className="absolute right-2 p-1 rounded text-white/40 hover:text-red-400 hover:bg-white/10 transition-colors"
                      aria-label="Delete chat"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Collapse toggle (visible when sidebar is collapsed) */}
      {isCollapsed && (
        <button
          onClick={() => setIsCollapsed(false)}
          className="fixed left-4 top-4 z-50 p-2 rounded-lg bg-black/40 backdrop-blur-xl border border-white/10 text-white/60 hover:text-white hover:bg-black/60 transition-colors"
          aria-label="Expand sidebar"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
      )}

      {/* Main Content */}
      <main
        className={cn(
          "flex-1 transition-all duration-300",
          isCollapsed ? "ml-0" : "ml-64"
        )}
      >
        {children}
      </main>
    </div>
  );
}

