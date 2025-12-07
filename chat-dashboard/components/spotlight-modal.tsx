"use client";

import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import { useRouter } from "next/navigation";
import { Search, MessageSquare, X, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseReaction } from "@/lib/reactions";

// ============================================================================
// Types
// ============================================================================

interface SearchResult {
  id: string;
  score: number;
  document: {
    text: string;
    sender: string;
    sender_is_me: boolean;
    participants: string[];
    chat_id: string;
    chat_name: string | null;
    is_dm: boolean;
    is_group_chat: boolean;
    timestamp: string;
    has_image: boolean;
  };
}

interface SearchResponse {
  messages: SearchResult[];
  images: SearchResult[];
  query?: string;
  total?: number;
  hasMore?: boolean;
}

interface SpotlightContextValue {
  isOpen: boolean;
  chatId: string | null;
  openSpotlight: (chatId?: string) => void;
  closeSpotlight: () => void;
}

interface SpotlightProviderProps {
  children: React.ReactNode;
  onScrollToMessage?: (timestamp: number, query: string) => void;
}

// ============================================================================
// Context
// ============================================================================

const SpotlightContext = createContext<SpotlightContextValue | null>(null);

export function useSpotlight() {
  const context = useContext(SpotlightContext);
  if (!context) {
    throw new Error("useSpotlight must be used within a SpotlightProvider");
  }
  return context;
}

// ============================================================================
// Helpers
// ============================================================================

// Get initials from name
function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// Avatar colors based on name hash
function getAvatarColor(name: string): string {
  const colors = [
    "bg-blue-500",
    "bg-purple-500",
    "bg-pink-500",
    "bg-red-500",
    "bg-orange-500",
    "bg-yellow-500",
    "bg-green-500",
    "bg-teal-500",
    "bg-cyan-500",
    "bg-indigo-500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

// Highlight matching keywords in text
function highlightMatches(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;

  const words = query.trim().split(/\s+/).filter(w => w.length >= 2);
  if (words.length === 0) return text;

  const escapedWords = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escapedWords.join('|')})`, 'gi');
  const parts = text.split(pattern);

  return parts.map((part, index) => {
    const isMatch = words.some(word => 
      part.toLowerCase() === word.toLowerCase()
    );

    if (isMatch) {
      return (
        <mark
          key={index}
          className="bg-yellow-400/40 text-inherit rounded-sm px-0.5"
        >
          {part}
        </mark>
      );
    }
    return part;
  });
}

// Format date
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) {
    return date.toLocaleDateString("en-US", { weekday: "long" });
  }
  return date.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" });
}

// Get Unix timestamp from ISO string
function getUnixTimestamp(timestamp: string): number {
  return Math.floor(new Date(timestamp).getTime() / 1000);
}

// Parse chunk text into individual messages
interface ParsedMessage {
  sender: string;
  text: string;
  isMe: boolean;
}

function parseChunkToMessages(text: string, participants: string[]): ParsedMessage[] {
  const rawMessages: ParsedMessage[] = [];
  const messagePattern = /\[([^\]]+?)\s+(\d{1,2}:\d{2}\s*(?:AM|PM)?)\]/gi;
  const parts = text.split(messagePattern);
  
  let i = parts[0].trim() ? 0 : 1;
  
  while (i < parts.length - 2) {
    const sender = parts[i].trim();
    let messageText = (parts[i + 2] || '').trim();
    messageText = messageText.replace(/^\s+/, '');
    
    if (sender && messageText) {
      const isMe = sender.toLowerCase() === 'me' || 
                   sender.toLowerCase().includes('shrey') ||
                   sender === 'You';
      
      rawMessages.push({
        sender: isMe ? 'Me' : sender,
        text: messageText,
        isMe,
      });
    }
    i += 3;
  }
  
  if (rawMessages.length === 0) {
    const lines = text.split('\n').filter(l => l.trim());
    for (const line of lines) {
      const match = line.match(/^\[([^\]]+?)\s+(\d{1,2}:\d{2}\s*(?:AM|PM)?)\]\s*(.*)/i);
      if (match) {
        const sender = match[1].trim();
        const messageText = match[3].trim();
        const isMe = sender.toLowerCase() === 'me' || sender.toLowerCase().includes('shrey');
        if (messageText) {
          rawMessages.push({ sender: isMe ? 'Me' : sender, text: messageText, isMe });
        }
      } else if (line.trim()) {
        rawMessages.push({ sender: participants[0] || 'Unknown', text: line.trim(), isMe: false });
      }
    }
  }
  
  if (rawMessages.length === 0 && text.trim()) {
    rawMessages.push({ sender: participants[0] || 'Unknown', text: text.trim(), isMe: false });
  }
  
  // Filter out reactions
  return rawMessages.filter(msg => !parseReaction(msg.text));
}

// Extract matching message from chunk
function extractMatchingMessage(chunkText: string, query: string, participants: string[]): { sender: string; text: string; contextBefore?: string } | null {
  if (!query.trim()) return null;

  const messages = parseChunkToMessages(chunkText, participants);
  if (messages.length === 0) return null;

  const queryLower = query.toLowerCase();
  const queryWords = query.trim().split(/\s+/).filter(w => w.length >= 2);
  
  let bestMatchIndex = -1;
  let bestMatchScore = 0;
  
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const msgLower = msg.text.toLowerCase();
    
    if (msgLower.includes(queryLower)) {
      bestMatchIndex = i;
      bestMatchScore = 100;
      break;
    }
    
    let wordMatches = 0;
    for (const word of queryWords) {
      if (msgLower.includes(word.toLowerCase())) {
        wordMatches++;
      }
    }
    
    if (wordMatches > bestMatchScore) {
      bestMatchScore = wordMatches;
      bestMatchIndex = i;
    }
  }
  
  if (bestMatchIndex === -1) {
    return { sender: messages[0].sender, text: messages[0].text };
  }
  
  const matchedMsg = messages[bestMatchIndex];
  const contextMsg = bestMatchIndex > 0 ? messages[bestMatchIndex - 1] : null;
  
  return {
    sender: matchedMsg.sender,
    text: matchedMsg.text,
    contextBefore: contextMsg ? `${contextMsg.sender}: ${contextMsg.text}` : undefined,
  };
}

// Preview message component
function PreviewMessage({ 
  chunkText, 
  query, 
  participants,
  isSelected 
}: { 
  chunkText: string; 
  query: string;
  participants: string[];
  isSelected: boolean;
}) {
  const extracted = extractMatchingMessage(chunkText, query, participants);
  
  if (!extracted) {
    return (
      <p className={cn(
        "mt-1 text-sm line-clamp-2",
        isSelected ? "text-white" : "text-gray-300"
      )}>
        {highlightMatches(chunkText.slice(0, 200), query)}
      </p>
    );
  }
  
  const senderIsMe = extracted.sender.toLowerCase() === 'me' || 
                     extracted.sender.toLowerCase().includes('shrey');
  
  return (
    <div className="mt-1 space-y-0.5">
      {extracted.contextBefore && (
        <p className={cn(
          "text-xs line-clamp-1",
          isSelected ? "text-blue-200/70" : "text-gray-500"
        )}>
          {extracted.contextBefore}
        </p>
      )}
      <p className={cn(
        "text-sm line-clamp-2",
        isSelected ? "text-white" : "text-gray-300"
      )}>
        <span className={cn(
          "font-medium",
          isSelected 
            ? "text-blue-100" 
            : senderIsMe ? "text-blue-400" : "text-purple-400"
        )}>
          {extracted.sender}:
        </span>
        {" "}
        {highlightMatches(extracted.text, query)}
      </p>
    </div>
  );
}

// ============================================================================
// Spotlight Modal Component
// ============================================================================

function SpotlightModalInner({ 
  chatId,
  onClose,
  onScrollToMessage,
}: { 
  chatId: string | null;
  onClose: () => void;
  onScrollToMessage?: (timestamp: number, query: string) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse>({ messages: [], images: [] });
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [total, setTotal] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const resultsRef = useRef<HTMLDivElement>(null);

  const isScoped = !!chatId;

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Search function
  const performSearch = useCallback(async (inputQuery: string) => {
    if (!inputQuery.trim()) {
      setResults({ messages: [], images: [] });
      setSearchQuery("");
      setTotal(0);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/spotlight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          query: inputQuery, 
          chatId: chatId || undefined,
          limit: 50 
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setResults(data);
        setSearchQuery(data.query || inputQuery);
        setSelectedIndex(0);
        setTotal(data.total || 0);
      }
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setIsLoading(false);
    }
  }, [chatId]);

  // Debounced input handler
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      performSearch(value);
    }, 150);
  };

  // Navigate to result
  const navigateToResult = useCallback((result: SearchResult) => {
    const timestamp = getUnixTimestamp(result.document.timestamp);
    
    if (isScoped && onScrollToMessage) {
      // Scoped mode: scroll to message in current conversation
      onScrollToMessage(timestamp, searchQuery);
      onClose();
    } else {
      // Global mode: navigate to conversation
      const encodedChatId = encodeURIComponent(result.document.chat_id);
      const queryParam = searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : "";
      router.push(`/conversation/${encodedChatId}?t=${timestamp}${queryParam}`);
      onClose();
    }
  }, [isScoped, onScrollToMessage, searchQuery, router, onClose]);

  // Scroll selected into view
  const scrollToSelected = (index: number) => {
    if (resultsRef.current) {
      const items = resultsRef.current.querySelectorAll('[data-result-item]');
      items[index]?.scrollIntoView({ block: 'nearest' });
    }
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const totalResults = results.messages.length;
    
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const newIndex = Math.min(selectedIndex + 1, totalResults - 1);
      setSelectedIndex(newIndex);
      scrollToSelected(newIndex);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const newIndex = Math.max(selectedIndex - 1, 0);
      setSelectedIndex(newIndex);
      scrollToSelected(newIndex);
    } else if (e.key === "Enter" && results.messages[selectedIndex]) {
      e.preventDefault();
      navigateToResult(results.messages[selectedIndex]);
    }
  };

  // Navigation buttons
  const goToPrevious = () => {
    if (selectedIndex > 0) {
      const newIndex = selectedIndex - 1;
      setSelectedIndex(newIndex);
      scrollToSelected(newIndex);
    }
  };

  const goToNext = () => {
    if (selectedIndex < results.messages.length - 1) {
      const newIndex = selectedIndex + 1;
      setSelectedIndex(newIndex);
      scrollToSelected(newIndex);
    }
  };

  const hasResults = results.messages.length > 0;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4">
        <div 
          className="w-full max-w-2xl bg-[#1c1c1e]/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/10 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Search Input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
            <Search className="h-5 w-5 text-gray-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={isScoped ? "Search in this conversation..." : "Search all messages..."}
              className="flex-1 bg-transparent text-lg text-white placeholder:text-gray-500 focus:outline-none"
              autoComplete="off"
              spellCheck={false}
            />
            
            {/* Result count and navigation (for scoped mode) */}
            {isScoped && hasResults && (
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-sm text-gray-400 tabular-nums mr-1">
                  {selectedIndex + 1} / {total}
                </span>
                <button
                  onClick={goToPrevious}
                  disabled={selectedIndex === 0}
                  className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronUp className="h-4 w-4 text-gray-400" />
                </button>
                <button
                  onClick={goToNext}
                  disabled={selectedIndex >= results.messages.length - 1}
                  className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronDown className="h-4 w-4 text-gray-400" />
                </button>
              </div>
            )}
            
            {isLoading && (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-400 border-t-transparent shrink-0" />
            )}
            
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors shrink-0"
            >
              <X className="h-5 w-5 text-gray-400" />
            </button>
          </div>

          {/* Results */}
          {hasResults && (
            <div ref={resultsRef} className="max-h-[60vh] overflow-y-auto">
              {/* Messages header */}
              <div className="flex items-center justify-between px-4 py-2 text-sm sticky top-0 bg-[#1c1c1e]/95 backdrop-blur-sm border-b border-white/5">
                <span className="font-semibold text-white">
                  {isScoped ? "Messages in conversation" : "Messages"}
                </span>
                {!isScoped && (
                  <span className="text-gray-400">
                    {total.toLocaleString()} results
                  </span>
                )}
              </div>

              {results.messages.map((result, index) => {
                const displayName = result.document.chat_name || result.document.sender;
                const displayInitials = result.document.chat_name 
                  ? getInitials(result.document.chat_name)
                  : getInitials(result.document.sender);
                
                return (
                  <div
                    key={`${result.id}-${index}`}
                    data-result-item
                    onClick={() => navigateToResult(result)}
                    className={cn(
                      "px-4 py-3 cursor-pointer transition-colors",
                      selectedIndex === index
                        ? "bg-blue-500"
                        : "hover:bg-white/5"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      {/* Avatar (hide in scoped mode for cleaner look) */}
                      {!isScoped && (
                        <div
                          className={cn(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white",
                            selectedIndex === index ? "bg-blue-400" : getAvatarColor(displayName)
                          )}
                        >
                          {displayInitials}
                        </div>
                      )}

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium truncate">
                            {isScoped ? "" : displayName}
                          </span>
                          <span className={cn(
                            "text-xs shrink-0",
                            selectedIndex === index ? "text-blue-100" : "text-gray-400"
                          )}>
                            {formatDate(result.document.timestamp)}
                          </span>
                        </div>
                        <PreviewMessage 
                          chunkText={result.document.text}
                          query={searchQuery}
                          participants={result.document.participants}
                          isSelected={selectedIndex === index}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Empty State */}
          {!hasResults && query && !isLoading && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
              <Search className="h-12 w-12 mb-3 opacity-50" />
              <span className="text-lg">No results for &ldquo;{query}&rdquo;</span>
            </div>
          )}

          {/* Initial State */}
          {!query && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
              <MessageSquare className="h-12 w-12 mb-3 opacity-50" />
              <span className="text-lg">
                {isScoped ? "Search this conversation" : "Search your messages"}
              </span>
              <span className="text-sm mt-1">Type to search instantly</span>
            </div>
          )}

          {/* Footer hints */}
          <div className="px-4 py-2 bg-black/30 border-t border-white/5">
            <div className="flex items-center justify-center gap-4 text-xs text-gray-500">
              <span>
                <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-[10px] mr-1">↑↓</kbd>
                Navigate
              </span>
              <span>
                <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-[10px] mr-1">↵</kbd>
                {isScoped ? "Go to message" : "Open conversation"}
              </span>
              <span>
                <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-[10px] mr-1">esc</kbd>
                Close
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ============================================================================
// Provider Component
// ============================================================================

export function SpotlightProvider({ children, onScrollToMessage }: SpotlightProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);

  const openSpotlight = useCallback((scopedChatId?: string) => {
    setChatId(scopedChatId || null);
    setIsOpen(true);
  }, []);

  const closeSpotlight = useCallback(() => {
    setIsOpen(false);
    setChatId(null);
  }, []);

  // Global keyboard shortcut: Cmd+K for global spotlight
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K or Ctrl+K for global spotlight
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (isOpen) {
          closeSpotlight();
        } else {
          openSpotlight();
        }
      }
      
      // Escape to close
      if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        closeSpotlight();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, openSpotlight, closeSpotlight]);

  return (
    <SpotlightContext.Provider value={{ isOpen, chatId, openSpotlight, closeSpotlight }}>
      {children}
      {isOpen && (
        <SpotlightModalInner 
          chatId={chatId} 
          onClose={closeSpotlight}
          onScrollToMessage={onScrollToMessage}
        />
      )}
    </SpotlightContext.Provider>
  );
}

