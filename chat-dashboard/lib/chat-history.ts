import { nanoid } from "nanoid";

// Message type matching the chat page
export interface ChatMessageData {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{
    toolName: string;
    args: Record<string, unknown>;
    result?: unknown;
    state: "pending" | "result";
  }>;
}

// Chat session stored in localStorage
export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessageData[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "imessage-chat-history";

// Check if we're in a browser environment
function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

// Get all chat sessions from localStorage
function getAllSessions(): ChatSession[] {
  if (!isBrowser()) return [];
  
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    return JSON.parse(data) as ChatSession[];
  } catch {
    console.error("Failed to parse chat history from localStorage");
    return [];
  }
}

// Save all sessions to localStorage
function saveAllSessions(sessions: ChatSession[]): void {
  if (!isBrowser()) return;
  
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch (error) {
    console.error("Failed to save chat history to localStorage:", error);
  }
}

// Generate a title from the first user message
function generateTitle(messages: ChatMessageData[]): string {
  const firstUserMessage = messages.find((m) => m.role === "user");
  if (!firstUserMessage) return "New Chat";
  
  const content = firstUserMessage.content.trim();
  // Truncate to 50 chars max
  if (content.length <= 50) return content;
  return content.slice(0, 47) + "...";
}

// Create a new chat session
export function createChat(): ChatSession {
  const session: ChatSession = {
    id: nanoid(10),
    title: "New Chat",
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  
  const sessions = getAllSessions();
  sessions.unshift(session);
  saveAllSessions(sessions);
  
  return session;
}

// Get a chat session by ID
export function getChat(id: string): ChatSession | null {
  const sessions = getAllSessions();
  return sessions.find((s) => s.id === id) || null;
}

// Update a chat session with new messages
export function updateChat(id: string, messages: ChatMessageData[]): ChatSession | null {
  const sessions = getAllSessions();
  const index = sessions.findIndex((s) => s.id === id);
  
  if (index === -1) return null;
  
  sessions[index] = {
    ...sessions[index],
    messages,
    title: generateTitle(messages),
    updatedAt: Date.now(),
  };
  
  saveAllSessions(sessions);
  return sessions[index];
}

// List all chat sessions (sorted by most recent)
export function listChats(): ChatSession[] {
  const sessions = getAllSessions();
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

// Delete a chat session
export function deleteChat(id: string): boolean {
  const sessions = getAllSessions();
  const index = sessions.findIndex((s) => s.id === id);
  
  if (index === -1) return false;
  
  sessions.splice(index, 1);
  saveAllSessions(sessions);
  return true;
}

// Format relative time for display
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

