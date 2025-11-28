/**
 * Messages API Route
 * Fetches messages from SQLite for a specific chat with bi-directional pagination
 */

import { getMessagesDB, type Message } from '@/lib/messages-db';
import { getContactResolver } from '@/lib/contacts';

export interface MessagesResponse {
  messages: MessageWithReactions[];
  chatInfo: {
    chatIdentifier: string;
    displayName: string | null;
    participants: { handleId: string; displayName: string }[];
    isGroupChat: boolean;
  } | null;
  hasMore: {
    before: boolean;
    after: boolean;
  };
  cursors: {
    oldest: number | null; // Unix timestamp of oldest message
    newest: number | null; // Unix timestamp of newest message
  };
}

export interface MessageWithReactions extends Message {
  displayName: string;
  reactions: { emoji: string; sender: string; isMe: boolean }[];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const chatId = searchParams.get('chatId');
  const direction = searchParams.get('direction') || 'around'; // 'before' | 'after' | 'around'
  const anchorParam = searchParams.get('anchor'); // Unix timestamp in seconds
  const limitParam = searchParams.get('limit');

  if (!chatId) {
    return Response.json({ error: 'Missing chatId parameter' }, { status: 400 });
  }

  const limit = limitParam ? parseInt(limitParam, 10) : 50;
  const anchor = anchorParam ? parseInt(anchorParam, 10) : Math.floor(Date.now() / 1000);

  try {
    const db = getMessagesDB();
    const contactResolver = getContactResolver();

    // Get chat info
    const chatInfo = db.getChatInfo(chatId);

    let messages: Message[] = [];
    let hasMore = { before: false, after: false };

    if (direction === 'around') {
      const result = db.getMessagesAround(chatId, anchor, limit);
      messages = result.messages;
      hasMore = result.hasMore;
    } else if (direction === 'before') {
      const result = db.getMessagesBefore(chatId, anchor, limit);
      messages = result.messages;
      hasMore.before = result.hasMore;
    } else if (direction === 'after') {
      const result = db.getMessagesAfter(chatId, anchor, limit);
      messages = result.messages;
      hasMore.after = result.hasMore;
    }

    // Get reactions for all messages
    const messageRowids = messages.map((m) => m.rowid);
    const reactions = db.getReactionsForMessages(messageRowids);

    // Enrich messages with display names and reactions
    const enrichedMessages: MessageWithReactions[] = messages.map((msg) => ({
      ...msg,
      displayName: msg.isFromMe ? 'Me' : contactResolver.getDisplayName(msg.handleId),
      reactions: reactions.get(msg.rowid) || [],
    }));

    // Build chat info with resolved names
    const enrichedChatInfo = chatInfo
      ? {
          ...chatInfo,
          participants: chatInfo.participants.map((handleId) => ({
            handleId,
            displayName: contactResolver.getDisplayName(handleId),
          })),
        }
      : null;

    // Calculate cursors
    const cursors = {
      oldest: messages.length > 0 ? messages[0].date : null,
      newest: messages.length > 0 ? messages[messages.length - 1].date : null,
    };

    const response: MessagesResponse = {
      messages: enrichedMessages,
      chatInfo: enrichedChatInfo,
      hasMore,
      cursors,
    };

    return Response.json(response);
  } catch (error) {
    console.error('Error fetching messages:', error);
    return Response.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }
}

