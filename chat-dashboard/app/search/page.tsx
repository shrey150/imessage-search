"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useSpotlight } from "@/components/spotlight-modal";
import { Search, ArrowLeft, MessageSquare, Calendar, Users, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

interface ChunkDocument {
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
}

interface ChunkData {
  id: string;
  document: ChunkDocument;
}

// ============================================================================
// Helpers
// ============================================================================

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

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

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { 
    weekday: "long",
    year: "numeric", 
    month: "long", 
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Parse chunk text into individual messages
interface ParsedMessage {
  sender: string;
  text: string;
  time?: string;
  isMe: boolean;
}

function parseChunkToMessages(text: string, participants: string[]): ParsedMessage[] {
  const rawMessages: ParsedMessage[] = [];
  const messagePattern = /\[([^\]]+?)\s+(\d{1,2}:\d{2}\s*(?:AM|PM)?)\]/gi;
  const parts = text.split(messagePattern);
  
  let i = parts[0].trim() ? 0 : 1;
  
  while (i < parts.length - 2) {
    const sender = parts[i].trim();
    const time = parts[i + 1].trim();
    let messageText = (parts[i + 2] || '').trim();
    messageText = messageText.replace(/^\s+/, '');
    
    if (sender && messageText) {
      const isMe = sender.toLowerCase() === 'me' || 
                   sender.toLowerCase().includes('shrey') ||
                   sender === 'You';
      
      rawMessages.push({
        sender: isMe ? 'Me' : sender,
        text: messageText,
        time,
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
        const time = match[2].trim();
        const messageText = match[3].trim();
        const isMe = sender.toLowerCase() === 'me' || sender.toLowerCase().includes('shrey');
        if (messageText) {
          rawMessages.push({ sender: isMe ? 'Me' : sender, text: messageText, time, isMe });
        }
      } else if (line.trim()) {
        rawMessages.push({ sender: participants[0] || 'Unknown', text: line.trim(), isMe: false });
      }
    }
  }
  
  if (rawMessages.length === 0 && text.trim()) {
    rawMessages.push({ sender: participants[0] || 'Unknown', text: text.trim(), isMe: false });
  }
  
  return rawMessages;
}

// ============================================================================
// Chunk View Component
// ============================================================================

function ChunkView({ chunkId }: { chunkId: string }) {
  const router = useRouter();
  const [chunk, setChunk] = useState<ChunkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchChunk() {
      try {
        const response = await fetch(`/api/chunk?id=${encodeURIComponent(chunkId)}`);
        if (!response.ok) {
          if (response.status === 404) {
            setError("Chunk not found");
          } else {
            setError("Failed to load chunk");
          }
          return;
        }
        const data = await response.json();
        setChunk(data);
      } catch (err) {
        console.error("Error fetching chunk:", err);
        setError("Failed to load chunk");
      } finally {
        setLoading(false);
      }
    }

    fetchChunk();
  }, [chunkId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#1a1a1e] text-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
          <p className="text-gray-400">Loading chunk...</p>
        </div>
      </div>
    );
  }

  if (error || !chunk) {
    return (
      <div className="min-h-screen bg-[#1a1a1e] text-white flex flex-col items-center justify-center">
        <div className="text-center max-w-md">
          <MessageSquare className="h-16 w-16 text-gray-600 mx-auto mb-4" />
          <h1 className="text-2xl font-semibold text-gray-300 mb-2">
            {error || "Chunk not found"}
          </h1>
          <p className="text-gray-500 mb-6">
            The message chunk you&apos;re looking for doesn&apos;t exist or has been removed.
          </p>
          <button
            onClick={() => router.push("/")}
            className="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-xl transition-colors"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  const doc = chunk.document;
  const displayName = doc.chat_name || doc.sender;
  const messages = parseChunkToMessages(doc.text, doc.participants);
  const timestamp = Math.floor(new Date(doc.timestamp).getTime() / 1000);

  return (
    <div className="min-h-screen bg-[#1a1a1e] text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#1a1a1e]/95 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.back()}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            >
              <ArrowLeft className="h-5 w-5 text-gray-400" />
            </button>
            
            <div className="flex items-center gap-3 flex-1">
              <div
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white",
                  getAvatarColor(displayName)
                )}
              >
                {getInitials(displayName)}
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="font-semibold truncate">{displayName}</h1>
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>{formatDate(doc.timestamp)}</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                const encodedChatId = encodeURIComponent(doc.chat_id);
                router.push(`/conversation/${encodedChatId}?t=${timestamp}`);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              View in Conversation
            </button>
          </div>
        </div>
      </div>

      {/* Chunk Info */}
      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Participants */}
        {doc.participants.length > 0 && (
          <div className="mb-6 flex items-center gap-2 text-sm text-gray-400">
            <Users className="h-4 w-4" />
            <span>Participants: {doc.participants.join(", ")}</span>
          </div>
        )}

        {/* Messages */}
        <div className="space-y-4">
          {messages.map((msg, index) => (
            <div
              key={index}
              className={cn(
                "flex",
                msg.isMe ? "justify-end" : "justify-start"
              )}
            >
              <div
                className={cn(
                  "max-w-[80%] px-4 py-2.5 rounded-2xl",
                  msg.isMe
                    ? "bg-blue-500 text-white rounded-br-md"
                    : "bg-[#2c2c2e] text-gray-100 rounded-bl-md"
                )}
              >
                {!msg.isMe && messages.filter(m => !m.isMe).length > 1 && (
                  <p className="text-xs font-medium text-purple-400 mb-1">
                    {msg.sender}
                  </p>
                )}
                <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                {msg.time && (
                  <p className={cn(
                    "text-xs mt-1",
                    msg.isMe ? "text-blue-200" : "text-gray-500"
                  )}>
                    {msg.time}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Chunk ID */}
        <div className="mt-8 pt-6 border-t border-white/10">
          <p className="text-xs text-gray-600 font-mono break-all">
            Chunk ID: {chunk.id}
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Search Page Content (with useSearchParams)
// ============================================================================

function SearchPageContent() {
  const searchParams = useSearchParams();
  const { openSpotlight, isOpen } = useSpotlight();
  
  const chunkId = searchParams.get("chunk");

  // If we have a chunk ID, display the chunk view
  if (chunkId) {
    return <ChunkView chunkId={chunkId} />;
  }

  // Otherwise, auto-open spotlight when this page loads (original behavior)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!isOpen) {
      openSpotlight();
    }
  }, [openSpotlight, isOpen]);

  return (
    <div className="min-h-screen bg-[#1a1a1e] text-white flex flex-col items-center justify-center">
      {/* Fallback content shown briefly before modal opens or if modal is closed */}
      {!isOpen && (
        <div className="text-center">
          <div className="mb-6">
            <Search className="h-16 w-16 text-gray-600 mx-auto" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-400 mb-2">Spotlight Search</h1>
          <p className="text-gray-500 mb-6">Search across all your messages</p>
          <button
            onClick={() => openSpotlight()}
            className="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-xl transition-colors"
          >
            Open Spotlight
          </button>
          <p className="mt-4 text-sm text-gray-600">
            or press <kbd className="px-2 py-1 bg-gray-800 rounded text-gray-400">⌘K</kbd>
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Search Page (with Suspense boundary for useSearchParams)
// ============================================================================

/**
 * Search page - handles both chunk viewing and spotlight search
 * - /search?chunk=<id> - displays a specific chunk
 * - /search - opens the spotlight modal
 */
export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#1a1a1e] text-white flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
      </div>
    }>
      <SearchPageContent />
    </Suspense>
  );
}
