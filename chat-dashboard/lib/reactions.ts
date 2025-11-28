/**
 * Shared reaction/tapback parsing utilities
 * Parses iMessage text-based reactions like "Loved 'message text'" into emoji representations
 */

// Quote characters: " " " ' ' (straight and curly)
const QUOTE_PATTERN = '["""\u2018\u2019\u201C\u201D\']';

export const REACTION_PATTERNS: { pattern: RegExp; emoji: string }[] = [
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

export interface ParsedReaction {
  emoji: string;
  originalText: string | null;
}

export interface Reaction {
  emoji: string;
  sender: string;
  isMe: boolean;
}

/**
 * Check if text is a reaction and return the emoji and original message text (if any)
 */
export function parseReaction(text: string): ParsedReaction | null {
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

/**
 * Check if a message text is a reaction
 */
export function isReactionMessage(text: string): boolean {
  return parseReaction(text) !== null;
}

/**
 * Generic message type for processing
 */
export interface MessageLike {
  text: string;
  isFromMe?: boolean;
  isMe?: boolean;
  displayName?: string;
  sender?: string;
}

/**
 * Process a list of messages to extract reactions and attach them to original messages
 * Returns filtered messages with reactions attached
 */
export function processMessagesWithReactions<T extends MessageLike>(
  messages: T[],
  getReactions: (msg: T) => Reaction[],
  setReactions: (msg: T, reactions: Reaction[]) => T
): T[] {
  const regularMessages: T[] = [];
  const reactionsList: { reaction: ParsedReaction; sender: string; isMe: boolean }[] = [];

  // First pass: separate reactions from regular messages
  for (const msg of messages) {
    const reaction = parseReaction(msg.text);
    const isMe = msg.isMe ?? msg.isFromMe ?? false;
    if (reaction) {
      reactionsList.push({
        reaction,
        sender: msg.displayName || msg.sender || 'Unknown',
        isMe,
      });
    } else {
      regularMessages.push(msg);
    }
  }

  // Second pass: attach text-based reactions to their original messages
  for (const { reaction, sender, isMe } of reactionsList) {
    if (reaction.originalText) {
      // Try to find a message that matches (partial match since reactions often truncate)
      const originalLower = reaction.originalText.toLowerCase().replace(/\.\.\.?$/, '');

      for (const msg of regularMessages) {
        const msgLower = msg.text.toLowerCase();
        // Check if message starts with or contains the reaction target
        if (msgLower.includes(originalLower) || originalLower.includes(msgLower.slice(0, 20))) {
          const currentReactions = getReactions(msg);
          const newReaction: Reaction = { emoji: reaction.emoji, sender, isMe };
          
          // Avoid duplicate reactions
          const isDuplicate = currentReactions.some(
            r => r.emoji === newReaction.emoji && r.sender === newReaction.sender
          );
          
          if (!isDuplicate) {
            const updatedMsg = setReactions(msg, [...currentReactions, newReaction]);
            const index = regularMessages.indexOf(msg);
            if (index !== -1) {
              regularMessages[index] = updatedMsg;
            }
          }
          break;
        }
      }
    } else {
      // Reaction without specific text - attach to the most recent message from someone else
      const msgIsMe = (m: T) => m.isMe ?? m.isFromMe ?? false;
      for (let i = regularMessages.length - 1; i >= 0; i--) {
        if (msgIsMe(regularMessages[i]) !== isMe) {
          const currentReactions = getReactions(regularMessages[i]);
          const newReaction: Reaction = { emoji: reaction.emoji, sender, isMe };
          
          const isDuplicate = currentReactions.some(
            r => r.emoji === newReaction.emoji && r.sender === newReaction.sender
          );
          
          if (!isDuplicate) {
            regularMessages[i] = setReactions(regularMessages[i], [...currentReactions, newReaction]);
          }
          break;
        }
      }
    }
  }

  return regularMessages;
}

