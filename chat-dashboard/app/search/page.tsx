"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Search, MessageSquare, Image as ImageIcon, X, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchResult {
  id: string;
  score: number;
  document: {
    text: string;
    sender: string;
    sender_is_me: boolean;
    participants: string[];
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
}

interface Reaction {
  emoji: string;
  sender: string;
  isMe: boolean;
}

interface ParsedMessage {
  sender: string;
  text: string;
  isMe: boolean;
  reactions?: Reaction[];
}

// Reaction type mappings - handles straight quotes, curly quotes, and partial quotes
// Quote characters: " " " ' ' (straight and curly)
const QUOTE_PATTERN = '["""\u2018\u2019\u201C\u201D\']';

const REACTION_PATTERNS: { pattern: RegExp; emoji: string }[] = [
  // Patterns with quotes (straight or curly)
  { pattern: new RegExp(`^Loved\\s+${QUOTE_PATTERN}(.+?)${QUOTE_PATTERN}?\\.?\\.?\\.?$`, 'i'), emoji: '❤️' },
  { pattern: new RegExp(`^Liked\\s+${QUOTE_PATTERN}(.+?)${QUOTE_PATTERN}?\\.?\\.?\\.?$`, 'i'), emoji: '👍' },
  { pattern: new RegExp(`^Disliked\\s+${QUOTE_PATTERN}(.+?)${QUOTE_PATTERN}?\\.?\\.?\\.?$`, 'i'), emoji: '👎' },
  { pattern: new RegExp(`^Laughed at\\s+${QUOTE_PATTERN}(.+?)${QUOTE_PATTERN}?\\.?\\.?\\.?$`, 'i'), emoji: '😂' },
  { pattern: new RegExp(`^Emphasized\\s+${QUOTE_PATTERN}(.+?)${QUOTE_PATTERN}?\\.?\\.?\\.?$`, 'i'), emoji: '‼️' },
  { pattern: new RegExp(`^Questioned\\s+${QUOTE_PATTERN}(.+?)${QUOTE_PATTERN}?\\.?\\.?\\.?$`, 'i'), emoji: '❓' },
  // Simple patterns without quotes
  { pattern: /^Loved$/i, emoji: '❤️' },
  { pattern: /^Liked$/i, emoji: '👍' },
  { pattern: /^Like$/i, emoji: '👍' },
  { pattern: /^Disliked$/i, emoji: '👎' },
  { pattern: /^Laughed$/i, emoji: '😂' },
  { pattern: /^Emphasized$/i, emoji: '‼️' },
  { pattern: /^Questioned$/i, emoji: '❓' },
];

// Check if text is a reaction and return the original message text (if any)
function parseReaction(text: string): { emoji: string; originalText: string | null } | null {
  const trimmed = text.trim();
  for (const { pattern, emoji } of REACTION_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      // match[1] will be the quoted text if it exists, otherwise undefined
      return { emoji, originalText: match[1] || null };
    }
  }
  return null;
}

// Parse chunk text into individual messages
// Handles format: [Name Time] message text
function parseChunkToMessages(text: string, participants: string[]): ParsedMessage[] {
  const rawMessages: { sender: string; text: string; isMe: boolean }[] = [];
  
  // Regex to match [Name Time] patterns
  const messagePattern = /\[([^\]]+?)\s+(\d{1,2}:\d{2}\s*(?:AM|PM)?)\]/gi;
  
  // Split by the pattern, keeping the delimiters
  const parts = text.split(messagePattern);
  
  // parts will be: [before, name, time, message, name, time, message, ...]
  let i = parts[0].trim() ? 0 : 1;
  
  while (i < parts.length - 2) {
    const sender = parts[i].trim();
    // parts[i + 1] contains time, but we don't use it here
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
  
  // If no messages were parsed, try a simpler newline-based approach
  if (rawMessages.length === 0) {
    const lines = text.split('\n').filter(l => l.trim());
    
    for (const line of lines) {
      const match = line.match(/^\[([^\]]+?)\s+(\d{1,2}:\d{2}\s*(?:AM|PM)?)\]\s*(.*)/i);
      
      if (match) {
        const sender = match[1].trim();
        const messageText = match[3].trim();
        const isMe = sender.toLowerCase() === 'me' || 
                     sender.toLowerCase().includes('shrey');
        
        if (messageText) {
          rawMessages.push({
            sender: isMe ? 'Me' : sender,
            text: messageText,
            isMe,
          });
        }
      } else if (line.trim()) {
        rawMessages.push({
          sender: participants[0] || 'Unknown',
          text: line.trim(),
          isMe: false,
        });
      }
    }
  }
  
  // If still no messages, treat whole thing as one
  if (rawMessages.length === 0 && text.trim()) {
    rawMessages.push({
      sender: participants[0] || 'Unknown',
      text: text.trim(),
      isMe: false,
    });
  }
  
  // Now process reactions - filter them out and attach to original messages where possible
  const messages: ParsedMessage[] = [];
  const reactionsList: { reaction: { emoji: string; originalText: string | null }; sender: string; isMe: boolean }[] = [];
  
  // First pass: separate reactions from regular messages
  for (const msg of rawMessages) {
    const reaction = parseReaction(msg.text);
    
    if (reaction) {
      // This is a reaction - save it but don't add to messages
      reactionsList.push({
        reaction,
        sender: msg.sender,
        isMe: msg.isMe,
      });
    } else {
      // Regular message
      messages.push({
        ...msg,
        reactions: undefined,
      });
    }
  }
  
  // Second pass: try to attach reactions to their original messages
  for (const { reaction, sender, isMe } of reactionsList) {
    if (reaction.originalText) {
      // Try to find a message that matches (partial match since reactions often truncate)
      const originalLower = reaction.originalText.toLowerCase().replace(/\.\.\.?$/, '');
      
      for (const msg of messages) {
        const msgLower = msg.text.toLowerCase();
        // Check if message starts with or contains the reaction target
        if (msgLower.includes(originalLower) || originalLower.includes(msgLower.slice(0, 20))) {
          msg.reactions = msg.reactions || [];
          msg.reactions.push({
            emoji: reaction.emoji,
            sender,
            isMe,
          });
          break;
        }
      }
    } else {
      // Reaction without specific text - attach to the most recent message from someone else
      // (reactions typically respond to the last message from the other person)
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].isMe !== isMe) {
          if (!messages[i].reactions) {
            messages[i].reactions = [];
          }
          messages[i].reactions!.push({
            emoji: reaction.emoji,
            sender,
            isMe,
          });
          break;
        }
      }
    }
  }
  
  return messages;
}

// Get initials from name
function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// Highlight matching keywords in text
function highlightMatches(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;

  // Get individual words from query (excluding very short ones)
  const words = query.trim().split(/\s+/).filter(w => w.length >= 2);
  if (words.length === 0) return text;

  // Create a regex pattern that matches any of the words (case insensitive)
  // Escape special regex characters in the words
  const escapedWords = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escapedWords.join('|')})`, 'gi');

  // Split text by the pattern, keeping the matched parts
  const parts = text.split(pattern);

  return parts.map((part, index) => {
    // Check if this part matches any of the search words
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

// Format date like Spotlight
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

// Format time for conversation
function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
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

// Conversation Viewer Component
function ConversationViewer({ 
  result, 
  onClose,
  searchQuery = "",
}: { 
  result: SearchResult; 
  onClose: () => void;
  searchQuery?: string;
}) {
  const router = useRouter();
  const messages = parseChunkToMessages(result.document.text, result.document.participants);
  const chatTitle = result.document.chat_name || result.document.participants.join(", ");

  const handleBack = () => {
    router.back();
  };

  const handleBackdropClick = () => {
    router.push("/search");
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={handleBackdropClick}
    >
      <div 
        className="w-full max-w-lg bg-[#1c1c1e] rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#2c2c2e] px-4 py-3 flex items-center gap-3 border-b border-white/10">
          <button
            onClick={handleBack}
            className="p-1 rounded-full hover:bg-white/10 transition-colors"
          >
            <ChevronLeft className="h-6 w-6 text-blue-400" />
          </button>
          
          <div className="flex items-center gap-3 flex-1">
            <div className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white",
              getAvatarColor(result.document.participants[0] || "?")
            )}>
              {getInitials(result.document.participants[0] || "?")}
            </div>
            <div>
              <div className="font-semibold text-white">{chatTitle}</div>
              <div className="text-xs text-gray-400">
                {formatDate(result.document.timestamp)} · {formatTime(result.document.timestamp)}
              </div>
            </div>
          </div>
          
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/10 transition-colors"
          >
            <X className="h-5 w-5 text-gray-400" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {messages.map((msg, index) => (
            <div
              key={index}
              className={cn(
                "flex items-end gap-2 w-full",
                msg.isMe ? "justify-end" : "justify-start",
                msg.reactions && msg.reactions.length > 0 ? "mb-5" : ""
              )}
            >
              {/* Avatar (only for others) */}
              {!msg.isMe && (
                <div className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white",
                  getAvatarColor(msg.sender)
                )}>
                  {getInitials(msg.sender)}
                </div>
              )}
              
              {/* Message Bubble */}
              <div className={cn(
                "relative max-w-[85%]",
                msg.isMe ? "ml-auto" : "mr-auto"
              )}>
                <div className={cn(
                  "rounded-2xl px-4 py-2.5",
                  msg.isMe 
                    ? "bg-blue-500 text-white rounded-br-md" 
                    : "bg-[#3a3a3c] text-white rounded-bl-md"
                )}>
                  {/* Sender name for group chats */}
                  {!msg.isMe && result.document.is_group_chat && (
                    <div className="text-xs text-gray-400 mb-1 font-medium">
                      {msg.sender}
                    </div>
                  )}
                  <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">
                    {highlightMatches(msg.text, searchQuery)}
                  </p>
                </div>
                
                {/* Reactions */}
                {msg.reactions && msg.reactions.length > 0 && (
                  <div className={cn(
                    "absolute -bottom-3 flex gap-0.5",
                    msg.isMe ? "right-2" : "left-2"
                  )}>
                    {msg.reactions.map((reaction, rIdx) => (
                      <span
                        key={rIdx}
                        className="flex items-center justify-center w-7 h-7 rounded-full bg-[#2a2a2e] border border-white/10 text-base shadow-lg"
                        title={`${reaction.sender} reacted`}
                      >
                        {reaction.emoji}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="bg-[#2c2c2e] px-4 py-3 border-t border-white/10">
          <div className="text-center text-xs text-gray-500">
            {result.document.participants.length} participants · {messages.length} messages in chunk
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SpotlightSearch() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse>({ messages: [], images: [] });
  const [searchQuery, setSearchQuery] = useState(""); // The query that was actually searched
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewingResult, setViewingResult] = useState<SearchResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const initialSearchDone = useRef(false);

  // Handle initial query from URL params or direct chunk link
  useEffect(() => {
    const chunkId = searchParams.get("chunk");
    const urlQuery = searchParams.get("q");
    
    // If chunk ID is provided, fetch and display it directly
    if (chunkId && !initialSearchDone.current) {
      initialSearchDone.current = true;
      fetch(`/api/chunk?id=${encodeURIComponent(chunkId)}`)
        .then(res => res.json())
        .then(data => {
          if (data && !data.error) {
            setViewingResult(data);
          }
        })
        .catch(console.error);
    }
    // Otherwise, handle search query
    else if (urlQuery && !initialSearchDone.current) {
      setQuery(urlQuery);
      initialSearchDone.current = true;
    }
  }, [searchParams]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close modal on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && viewingResult) {
        setViewingResult(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [viewingResult]);

  // Debounced search
  const performSearch = useCallback(async (inputQuery: string) => {
    if (!inputQuery.trim()) {
      setResults({ messages: [], images: [] });
      setSearchQuery("");
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/spotlight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: inputQuery }),
      });

      if (response.ok) {
        const data = await response.json();
        setResults(data);
        setSearchQuery(data.query || inputQuery); // Store the searched query for highlighting
        setSelectedIndex(0);
      }
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Trigger search when query changes from URL params
  useEffect(() => {
    if (query && initialSearchDone.current) {
      performSearch(query);
    }
  }, [query, performSearch]);

  // Handle input change with debounce
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

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const totalResults = results.messages.length + results.images.length;
    
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, totalResults - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && results.messages[selectedIndex]) {
      e.preventDefault();
      setViewingResult(results.messages[selectedIndex]);
    }
  };

  const hasResults = results.messages.length > 0 || results.images.length > 0;

  return (
    <div className="min-h-screen bg-[#1a1a1e] text-white">
      {/* Conversation Viewer Modal */}
      {viewingResult && (
        <ConversationViewer 
          result={viewingResult} 
          onClose={() => setViewingResult(null)}
          searchQuery={searchQuery}
        />
      )}

      {/* Search Container */}
      <div className="mx-auto max-w-3xl pt-8 px-4">
        {/* Search Box */}
        <div className="rounded-2xl bg-[#2a2a2e] shadow-2xl overflow-hidden">
          {/* Search Input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
            <Search className="h-5 w-5 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Search messages..."
              className="flex-1 bg-transparent text-lg text-white placeholder:text-gray-500 focus:outline-none"
              autoComplete="off"
              spellCheck={false}
            />
            {isLoading && (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
            )}
          </div>

          {/* Results */}
          {hasResults && (
            <div className="max-h-[70vh] overflow-y-auto">
              {/* Messages Section */}
              {results.messages.length > 0 && (
                <div>
                  <div className="flex items-center justify-between px-4 py-2 text-sm">
                    <span className="font-semibold text-white">Messages</span>
                    <span className="text-gray-400">›</span>
                  </div>

                  {results.messages.map((result, index) => {
                    // For group chats, show chat name. For DMs, show the other person's name.
                    const displayName = result.document.chat_name || result.document.sender;
                    const displayInitials = result.document.chat_name 
                      ? getInitials(result.document.chat_name)
                      : getInitials(result.document.sender);
                    
                    return (
                      <div
                        key={result.id}
                        onClick={() => setViewingResult(result)}
                        className={cn(
                          "px-4 py-3 cursor-pointer transition-colors",
                          selectedIndex === index
                            ? "bg-blue-500"
                            : "hover:bg-white/5"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          {/* Avatar */}
                          <div
                            className={cn(
                              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white",
                              selectedIndex === index ? "bg-blue-400" : getAvatarColor(displayName)
                            )}
                          >
                            {displayInitials}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium truncate">
                                {displayName}
                              </span>
                              <span className={cn(
                                "text-xs shrink-0",
                                selectedIndex === index ? "text-blue-100" : "text-gray-400"
                              )}>
                                {formatDate(result.document.timestamp)}
                              </span>
                            </div>
                            <p className={cn(
                              "mt-1 text-sm line-clamp-2",
                              selectedIndex === index ? "text-white" : "text-gray-300"
                            )}>
                              {highlightMatches(result.document.text, searchQuery)}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Images Section */}
              <div className="border-t border-white/10">
                <div className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="font-semibold text-white">Images</span>
                </div>

                {results.images.length > 0 ? (
                  <div className="grid grid-cols-4 gap-2 p-4">
                    {results.images.slice(0, 8).map((result) => (
                      <div
                        key={result.id}
                        className="aspect-square rounded-lg bg-gray-700 flex items-center justify-center cursor-pointer hover:bg-gray-600 transition-colors"
                        onClick={() => setViewingResult(result)}
                      >
                        <ImageIcon className="h-8 w-8 text-gray-500" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                    <Search className="h-12 w-12 mb-3 opacity-50" />
                    <span className="text-lg font-medium">No Image Results</span>
                  </div>
                )}
              </div>
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
              <span className="text-lg">Search your messages</span>
              <span className="text-sm mt-1">Type to search instantly</span>
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="mt-4 text-center text-xs text-gray-500">
          <span className="px-2 py-1 rounded bg-gray-800 mr-2">↑↓</span>
          Navigate
          <span className="ml-4 px-2 py-1 rounded bg-gray-800 mr-2">⏎</span>
          Open
          <span className="ml-4 px-2 py-1 rounded bg-gray-800 mr-2">esc</span>
          Close
        </div>
      </div>
    </div>
  );
}
