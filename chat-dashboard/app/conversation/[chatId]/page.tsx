"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { ChevronLeft, Loader2, X, ZoomIn, ZoomOut, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { processMessagesWithReactions, type Reaction } from "@/lib/reactions";
import type { MessagesResponse, MessageWithReactions } from "@/app/api/messages/route";
import { extractUrls, isUrlOnlyMessage, LinkPreview } from "@/components/link-preview";

// Image Lightbox Component
function ImageLightbox({ 
  src, 
  alt, 
  onClose 
}: { 
  src: string; 
  alt: string; 
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") setScale(s => Math.min(s + 0.25, 4));
      if (e.key === "-") setScale(s => Math.max(s - 0.25, 0.5));
      if (e.key === "r") setRotation(r => (r + 90) % 360);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div 
      className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Controls */}
      <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
        <button
          onClick={(e) => { e.stopPropagation(); setScale(s => Math.max(s - 0.25, 0.5)); }}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          title="Zoom out (-)"
        >
          <ZoomOut className="h-5 w-5" />
        </button>
        <span className="text-white/70 text-sm min-w-[60px] text-center">
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); setScale(s => Math.min(s + 0.25, 4)); }}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          title="Zoom in (+)"
        >
          <ZoomIn className="h-5 w-5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setRotation(r => (r + 90) % 360); }}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          title="Rotate (R)"
        >
          <RotateCw className="h-5 w-5" />
        </button>
        <button
          onClick={onClose}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors ml-2"
          title="Close (Esc)"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Image */}
      <img
        src={src}
        alt={alt}
        className="max-w-[90vw] max-h-[90vh] object-contain transition-transform duration-200"
        style={{ 
          transform: `scale(${scale}) rotate(${rotation}deg)`,
        }}
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />

      {/* Hint */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/50 text-sm">
        Double-click image or press Esc to close • Scroll or +/- to zoom • R to rotate
      </div>
    </div>
  );
}

// Reaction emoji display (fallback map for any custom emojis)
const REACTION_EMOJIS: Record<string, string> = {
  "❤️": "❤️",
  "👍": "👍",
  "👎": "👎",
  "😂": "😂",
  "‼️": "‼️",
  "❓": "❓",
};

// Get initials from name
function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// Avatar colors based on name hash (iOS-like colors)
function getAvatarColor(name: string): string {
  const colors = [
    "bg-[#FF3B30]", // Red
    "bg-[#FF9500]", // Orange
    "bg-[#FFCC00]", // Yellow
    "bg-[#34C759]", // Green
    "bg-[#00C7BE]", // Teal
    "bg-[#30B0C7]", // Cyan
    "bg-[#007AFF]", // Blue
    "bg-[#5856D6]", // Indigo
    "bg-[#AF52DE]", // Purple
    "bg-[#FF2D55]", // Pink
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

// Format timestamp for message groups (iOS style)
function formatDateHeader(dateMs: number): string {
  const date = new Date(dateMs);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }
  if (diffDays === 1) {
    return "Yesterday";
  }
  if (diffDays < 7) {
    return date.toLocaleDateString("en-US", { weekday: "long" });
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

// Format time for individual messages
function formatTime(dateMs: number): string {
  return new Date(dateMs).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// Check if two messages should be grouped (same sender, within 1 minute)
function shouldGroupMessages(
  current: MessageWithReactions,
  previous: MessageWithReactions | null
): boolean {
  if (!previous) return false;
  if (current.isFromMe !== previous.isFromMe) return false;
  if (!current.isFromMe && current.handleId !== previous.handleId) return false;
  
  const timeDiff = current.dateMs - previous.dateMs;
  return timeDiff < 60000; // 1 minute
}

// Check if we should show a date separator
function shouldShowDateSeparator(
  current: MessageWithReactions,
  previous: MessageWithReactions | null
): boolean {
  if (!previous) return true;
  
  const currentDate = new Date(current.dateMs);
  const previousDate = new Date(previous.dateMs);
  
  // Show separator if different day or more than 1 hour apart
  const timeDiff = current.dateMs - previous.dateMs;
  if (timeDiff > 3600000) return true; // 1 hour
  
  return currentDate.toDateString() !== previousDate.toDateString();
}

// Highlight search terms in text
function highlightText(text: string, searchQuery: string): React.ReactNode {
  if (!searchQuery.trim()) return text;

  const words = searchQuery.trim().split(/\s+/).filter((w) => w.length >= 2);
  if (words.length === 0) return text;

  const escapedWords = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escapedWords.join("|")})`, "gi");
  const parts = text.split(pattern);

  return parts.map((part, index) => {
    const isMatch = words.some((word) => part.toLowerCase() === word.toLowerCase());
    if (isMatch) {
      return (
        <mark
          key={index}
          className="bg-yellow-400/60 text-inherit rounded-sm px-0.5"
        >
          {part}
        </mark>
      );
    }
    return part;
  });
}

// Message Bubble Component (iOS-style)
function MessageBubble({
  message,
  isGrouped,
  isLastInGroup,
  showAvatar,
  isGroupChat,
  searchQuery,
  isAnchor,
  onImageDoubleClick,
}: {
  message: MessageWithReactions;
  isGrouped: boolean;
  isLastInGroup: boolean;
  showAvatar: boolean;
  isGroupChat: boolean;
  searchQuery: string;
  isAnchor: boolean;
  onImageDoubleClick: (src: string, alt: string) => void;
}) {
  const hasReactions = message.reactions && message.reactions.length > 0;

  return (
    <div
      className={cn(
        "flex w-full",
        message.isFromMe ? "justify-end" : "justify-start",
        isGrouped ? "mt-0.5" : "mt-2",
        hasReactions && "mb-4"
      )}
      data-rowid={message.rowid}
    >
      {/* Avatar for received messages in group chats */}
      {!message.isFromMe && isGroupChat && (
        <div className="w-8 mr-2 flex-shrink-0 flex items-end">
          {showAvatar ? (
            <div
              className={cn(
                "w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white",
                getAvatarColor(message.displayName)
              )}
            >
              {getInitials(message.displayName)}
            </div>
          ) : null}
        </div>
      )}

      <div
        className={cn(
          "relative max-w-[70%] min-w-[40px]",
          message.isFromMe ? "mr-2" : "ml-2"
        )}
      >
        {/* Sender name for group chats - positioned to not affect bubble width */}
        {!message.isFromMe && isGroupChat && !isGrouped && (
          <div className="text-[11px] text-gray-500 ml-3 mb-0.5 font-medium whitespace-nowrap w-0 overflow-visible">
            {message.displayName}
          </div>
        )}

        {/* Image attachments */}
        {message.attachments && message.attachments.filter(a => a.isImage).length > 0 && (() => {
          // Strip Object Replacement Character (U+FFFC) used by iMessage for attachment placeholders
          const cleanText = message.text?.replace(/\uFFFC/g, '').trim();
          const hasText = cleanText && cleanText.length > 0;
          return (
            <div className={cn(
              "overflow-hidden",
              hasText && "mb-1", // Only add margin if there's text below
              message.isFromMe
                ? cn("rounded-[18px]", isLastInGroup && !hasText && "rounded-br-[4px]")
                : cn("rounded-[18px]", isLastInGroup && !hasText && "rounded-bl-[4px]"),
              isAnchor && "ring-2 ring-yellow-400 ring-offset-2 ring-offset-[#000]"
            )}>
              {message.attachments.filter(a => a.isImage).map((attachment) => {
                const imgSrc = `/api/image?path=${encodeURIComponent(attachment.filename)}`;
                const imgAlt = attachment.transferName || "Image";
                return (
                  <img
                    key={attachment.rowid}
                    src={imgSrc}
                    alt={imgAlt}
                    className="max-w-full max-h-[300px] object-contain bg-black/5 dark:bg-white/5 cursor-pointer"
                    loading="lazy"
                    onDoubleClick={() => onImageDoubleClick(imgSrc, imgAlt)}
                    title="Double-click to expand"
                  />
                );
              })}
            </div>
          );
        })()}

        {/* Message bubble (only show if there's meaningful text) */}
        {(() => {
          // Strip Object Replacement Character (U+FFFC) used by iMessage for attachment placeholders
          const cleanText = message.text?.replace(/\uFFFC/g, '').trim();
          if (!cleanText) return null;
          
          const urls = extractUrls(cleanText);
          const primaryUrl = urls[0];
          const isUrlOnly = isUrlOnlyMessage(cleanText);

          // URL-only message: show just the link preview
          if (isUrlOnly && primaryUrl) {
            return (
              <div className={cn(
                isAnchor && "ring-2 ring-yellow-400 ring-offset-2 ring-offset-[#000] rounded-xl"
              )}>
                <LinkPreview 
                  url={primaryUrl} 
                  isFromMe={message.isFromMe}
                  className={cn(
                    message.isFromMe
                      ? isLastInGroup && "rounded-br-[4px]"
                      : isLastInGroup && "rounded-bl-[4px]"
                  )}
                />
              </div>
            );
          }

          // Regular message with optional link preview below
          return (
            <>
              <div
                className={cn(
                  "relative px-3 py-2 wrap-break-word w-fit",
                  // Colors
                  message.isFromMe
                    ? "bg-[#007AFF] text-white"
                    : "bg-[#E9E9EB] text-black dark:bg-[#3A3A3C] dark:text-white",
                  // Border radius - iOS style with tails
                  message.isFromMe
                    ? cn(
                        "rounded-[18px]",
                        isLastInGroup && !primaryUrl && "rounded-br-[4px]"
                      )
                    : cn(
                        "rounded-[18px]",
                        isLastInGroup && !primaryUrl && "rounded-bl-[4px]"
                      ),
                  // Anchor highlight
                  isAnchor && "ring-2 ring-yellow-400 ring-offset-2 ring-offset-[#000]"
                )}
              >
                <p className="text-[15px] leading-[1.35] whitespace-pre-wrap">
                  {highlightText(cleanText, searchQuery)}
                </p>
              </div>
              
              {/* Link preview for first URL */}
              {primaryUrl && (
                <LinkPreview 
                  url={primaryUrl} 
                  isFromMe={message.isFromMe}
                  className={cn(
                    "mt-1",
                    message.isFromMe
                      ? isLastInGroup && "rounded-br-[4px]"
                      : isLastInGroup && "rounded-bl-[4px]"
                  )}
                />
              )}
            </>
          );
        })()}

        {/* Reactions (Tapbacks) */}
        {hasReactions && (
          <div
            className={cn(
              "absolute -bottom-3 flex gap-0.5",
              message.isFromMe ? "right-2" : "left-2"
            )}
          >
            <div className="flex items-center gap-0.5 bg-white dark:bg-[#2C2C2E] rounded-full px-1.5 py-0.5 shadow-sm border border-gray-200 dark:border-gray-700">
              {/* Group same reactions together */}
              {Object.entries(
                message.reactions.reduce(
                  (acc, r) => {
                    acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                    return acc;
                  },
                  {} as Record<string, number>
                )
              ).map(([emoji, count]) => (
                <span key={emoji} className="flex items-center text-sm">
                  {REACTION_EMOJIS[emoji] || emoji}
                  {count > 1 && (
                    <span className="text-[10px] text-gray-500 ml-0.5">{count}</span>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Delivery status for sent messages */}
        {message.isFromMe && isLastInGroup && (
          <div className="text-[11px] text-gray-500 text-right mr-1 mt-0.5">
            {message.isRead ? "Read" : message.isDelivered ? "Delivered" : "Sent"}
          </div>
        )}
      </div>
    </div>
  );
}

// Date separator component
function DateSeparator({ dateMs }: { dateMs: number }) {
  return (
    <div className="flex justify-center my-4">
      <span className="text-[11px] text-gray-500 font-medium px-2 py-1">
        {formatDateHeader(dateMs)}
      </span>
    </div>
  );
}

// Loading spinner component
function LoadingSpinner({ position }: { position: "top" | "bottom" }) {
  return (
    <div
      className={cn(
        "flex justify-center py-4",
        position === "top" ? "order-first" : "order-last"
      )}
    >
      <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
    </div>
  );
}

export default function ConversationPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  const chatId = decodeURIComponent(params.chatId as string);
  const anchorTimestamp = searchParams.get("t");
  const searchQuery = searchParams.get("q") || "";

  const [messages, setMessages] = useState<MessageWithReactions[]>([]);
  const [chatInfo, setChatInfo] = useState<MessagesResponse["chatInfo"]>(null);
  const [hasMore, setHasMore] = useState({ before: false, after: false });
  const [cursors, setCursors] = useState<{ oldest: number | null; newest: number | null }>({
    oldest: null,
    newest: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState({ before: false, after: false });
  const [anchorRowid, setAnchorRowid] = useState<number | null>(null);
  const [hasScrolledToAnchor, setHasScrolledToAnchor] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);

  // Process messages to extract text-based reactions and attach them to original messages
  const processedMessages = useMemo(() => {
    return processMessagesWithReactions<MessageWithReactions>(
      messages,
      // Get existing reactions from the message
      (msg) => msg.reactions || [],
      // Set reactions on the message (return new object)
      (msg, reactions) => ({ ...msg, reactions })
    );
  }, [messages]);

  // Fetch initial messages
  const fetchMessages = useCallback(async () => {
    setIsLoading(true);
    try {
      const anchor = anchorTimestamp
        ? parseInt(anchorTimestamp, 10)
        : Math.floor(Date.now() / 1000);

      const response = await fetch(
        `/api/messages?chatId=${encodeURIComponent(chatId)}&direction=around&anchor=${anchor}&limit=60`
      );

      if (!response.ok) throw new Error("Failed to fetch messages");

      const data: MessagesResponse = await response.json();
      setMessages(data.messages);
      setChatInfo(data.chatInfo);
      setHasMore(data.hasMore);
      setCursors(data.cursors);

      // Find the anchor message (closest to the timestamp)
      if (anchorTimestamp) {
        const targetTime = parseInt(anchorTimestamp, 10) * 1000;
        let closestMessage = data.messages[0];
        let closestDiff = Math.abs(closestMessage?.dateMs - targetTime);

        for (const msg of data.messages) {
          const diff = Math.abs(msg.dateMs - targetTime);
          if (diff < closestDiff) {
            closestDiff = diff;
            closestMessage = msg;
          }
        }

        if (closestMessage) {
          setAnchorRowid(closestMessage.rowid);
        }
      }
    } catch (error) {
      console.error("Error fetching messages:", error);
    } finally {
      setIsLoading(false);
    }
  }, [chatId, anchorTimestamp]);

  // Load more messages (before)
  const loadMoreBefore = useCallback(async () => {
    if (isLoadingMore.before || !hasMore.before || !cursors.oldest) return;

    setIsLoadingMore((prev) => ({ ...prev, before: true }));

    try {
      const response = await fetch(
        `/api/messages?chatId=${encodeURIComponent(chatId)}&direction=before&anchor=${cursors.oldest}&limit=30`
      );

      if (!response.ok) throw new Error("Failed to fetch more messages");

      const data: MessagesResponse = await response.json();

      if (data.messages.length > 0) {
        // Preserve scroll position
        const container = containerRef.current;
        const oldScrollHeight = container?.scrollHeight || 0;

        setMessages((prev) => [...data.messages, ...prev]);
        setHasMore((prev) => ({ ...prev, before: data.hasMore.before }));
        setCursors((prev) => ({ ...prev, oldest: data.cursors.oldest }));

        // Restore scroll position after new messages are rendered
        requestAnimationFrame(() => {
          if (container) {
            const newScrollHeight = container.scrollHeight;
            container.scrollTop = newScrollHeight - oldScrollHeight;
          }
        });
      }
    } catch (error) {
      console.error("Error loading more messages:", error);
    } finally {
      setIsLoadingMore((prev) => ({ ...prev, before: false }));
    }
  }, [chatId, cursors.oldest, hasMore.before, isLoadingMore.before]);

  // Load more messages (after)
  const loadMoreAfter = useCallback(async () => {
    if (isLoadingMore.after || !hasMore.after || !cursors.newest) return;

    setIsLoadingMore((prev) => ({ ...prev, after: true }));

    try {
      const response = await fetch(
        `/api/messages?chatId=${encodeURIComponent(chatId)}&direction=after&anchor=${cursors.newest}&limit=30`
      );

      if (!response.ok) throw new Error("Failed to fetch more messages");

      const data: MessagesResponse = await response.json();

      if (data.messages.length > 0) {
        setMessages((prev) => [...prev, ...data.messages]);
        setHasMore((prev) => ({ ...prev, after: data.hasMore.after }));
        setCursors((prev) => ({ ...prev, newest: data.cursors.newest }));
      }
    } catch (error) {
      console.error("Error loading more messages:", error);
    } finally {
      setIsLoadingMore((prev) => ({ ...prev, after: false }));
    }
  }, [chatId, cursors.newest, hasMore.after, isLoadingMore.after]);

  // Initial fetch
  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Scroll to anchor message
  useEffect(() => {
    if (!isLoading && anchorRowid && !hasScrolledToAnchor) {
      requestAnimationFrame(() => {
        const anchorElement = document.querySelector(`[data-rowid="${anchorRowid}"]`);
        if (anchorElement) {
          anchorElement.scrollIntoView({ behavior: "instant", block: "center" });
          setHasScrolledToAnchor(true);
        }
      });
    }
  }, [isLoading, anchorRowid, hasScrolledToAnchor]);

  // Intersection observer for infinite scroll
  useEffect(() => {
    const options = {
      root: containerRef.current,
      rootMargin: "100px",
      threshold: 0,
    };

    const topObserver = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        loadMoreBefore();
      }
    }, options);

    const bottomObserver = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        loadMoreAfter();
      }
    }, options);

    if (topSentinelRef.current) {
      topObserver.observe(topSentinelRef.current);
    }

    if (bottomSentinelRef.current) {
      bottomObserver.observe(bottomSentinelRef.current);
    }

    return () => {
      topObserver.disconnect();
      bottomObserver.disconnect();
    };
  }, [loadMoreBefore, loadMoreAfter]);

  // Get chat display name
  const chatDisplayName =
    chatInfo?.displayName ||
    (chatInfo?.participants.length === 1
      ? chatInfo.participants[0].displayName
      : chatInfo?.participants.map((p) => p.displayName.split(" ")[0]).join(", ")) ||
    "Conversation";

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-black">
      {/* iOS-style header */}
      <header className="flex items-center gap-2 px-2 py-2 bg-[#F6F6F6] dark:bg-[#1C1C1E] border-b border-gray-200 dark:border-gray-800 safe-area-inset-top">
        <button
          onClick={() => router.back()}
          className="flex items-center text-[#007AFF] hover:opacity-70 transition-opacity"
        >
          <ChevronLeft className="h-7 w-7 -mr-1" />
          <span className="text-[17px]">Back</span>
        </button>

        <div className="flex-1 flex flex-col items-center">
          {chatInfo?.isGroupChat ? (
            <>
              <div className="flex -space-x-2 mb-0.5">
                {chatInfo.participants.slice(0, 3).map((p, i) => (
                  <div
                    key={p.handleId}
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold text-white border-2 border-[#F6F6F6] dark:border-[#1C1C1E]",
                      getAvatarColor(p.displayName)
                    )}
                    style={{ zIndex: 3 - i }}
                  >
                    {getInitials(p.displayName)}
                  </div>
                ))}
                {chatInfo.participants.length > 3 && (
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold text-gray-600 bg-gray-300 dark:bg-gray-600 dark:text-gray-300 border-2 border-[#F6F6F6] dark:border-[#1C1C1E]">
                    +{chatInfo.participants.length - 3}
                  </div>
                )}
              </div>
              <span className="text-[11px] text-gray-500 font-medium">
                {chatInfo.participants.length} people
              </span>
            </>
          ) : (
            <>
              <div
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold text-white mb-0.5",
                  getAvatarColor(chatDisplayName)
                )}
              >
                {getInitials(chatDisplayName)}
              </div>
              <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100 truncate max-w-[200px]">
                {chatDisplayName}
              </span>
            </>
          )}
        </div>

        {/* Spacer for centering */}
        <div className="w-[60px]" />
      </header>

      {/* Messages area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-2 py-2 bg-white dark:bg-black"
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        ) : processedMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            No messages found
          </div>
        ) : (
          <>
            {/* Top sentinel for infinite scroll */}
            <div ref={topSentinelRef} className="h-1" />

            {/* Loading indicator for older messages */}
            {isLoadingMore.before && <LoadingSpinner position="top" />}

            {/* Messages */}
            {processedMessages.map((message, index) => {
              const prevMessage = index > 0 ? processedMessages[index - 1] : null;
              const nextMessage = index < processedMessages.length - 1 ? processedMessages[index + 1] : null;

              const showDateSeparator = shouldShowDateSeparator(message, prevMessage);
              const isGrouped = shouldGroupMessages(message, prevMessage);
              const isLastInGroup = !nextMessage || !shouldGroupMessages(nextMessage, message);
              const showAvatar = isLastInGroup && !message.isFromMe;

              return (
                <div key={message.rowid}>
                  {showDateSeparator && <DateSeparator dateMs={message.dateMs} />}
                  <MessageBubble
                    message={message}
                    isGrouped={isGrouped}
                    isLastInGroup={isLastInGroup}
                    showAvatar={showAvatar}
                    isGroupChat={chatInfo?.isGroupChat || false}
                    searchQuery={searchQuery}
                    isAnchor={message.rowid === anchorRowid}
                    onImageDoubleClick={(src, alt) => setLightboxImage({ src, alt })}
                  />
                </div>
              );
            })}

            {/* Loading indicator for newer messages */}
            {isLoadingMore.after && <LoadingSpinner position="bottom" />}

            {/* Bottom sentinel for infinite scroll */}
            <div ref={bottomSentinelRef} className="h-1" />
          </>
        )}
      </div>

      {/* Optional: Input area placeholder (read-only for now) */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#F6F6F6] dark:bg-[#1C1C1E] border-t border-gray-200 dark:border-gray-800 safe-area-inset-bottom">
        <div className="flex-1 px-4 py-2 bg-white dark:bg-[#3A3A3C] rounded-full text-gray-400 text-[15px]">
          iMessage (Read Only)
        </div>
      </div>

      {/* Image Lightbox */}
      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage.src}
          alt={lightboxImage.alt}
          onClose={() => setLightboxImage(null)}
        />
      )}
    </div>
  );
}

