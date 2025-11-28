/**
 * Shared reaction/tapback parsing utilities
 * Parses iMessage text-based reactions like "Loved 'message text'" into emoji representations
 */

// Quote characters: " " " ' ' (straight and curly)
const QUOTE_PATTERN = '["""\u2018\u2019\u201C\u201D\']';

export const REACTION_PATTERNS: { pattern: RegExp; emoji: string; isImageReaction?: boolean }[] = [
  // Patterns with quotes (straight or curly) - use [\s\S] to match newlines in multi-line messages
  { pattern: new RegExp(`^Loved\\s+${QUOTE_PATTERN}([\\s\\S]+?)${QUOTE_PATTERN}?\\.?\\.?\\.?$`, 'i'), emoji: '❤️' },
  { pattern: new RegExp(`^Liked\\s+${QUOTE_PATTERN}([\\s\\S]+?)${QUOTE_PATTERN}?\\.?\\.?\\.?$`, 'i'), emoji: '👍' },
  { pattern: new RegExp(`^Disliked\\s+${QUOTE_PATTERN}([\\s\\S]+?)${QUOTE_PATTERN}?\\.?\\.?\\.?$`, 'i'), emoji: '👎' },
  { pattern: new RegExp(`^Laughed at\\s+${QUOTE_PATTERN}([\\s\\S]+?)${QUOTE_PATTERN}?\\.?\\.?\\.?$`, 'i'), emoji: '😂' },
  { pattern: new RegExp(`^Emphasized\\s+${QUOTE_PATTERN}([\\s\\S]+?)${QUOTE_PATTERN}?\\.?\\.?\\.?$`, 'i'), emoji: '‼️' },
  { pattern: new RegExp(`^Questioned\\s+${QUOTE_PATTERN}([\\s\\S]+?)${QUOTE_PATTERN}?\\.?\\.?\\.?$`, 'i'), emoji: '❓' },
  // Image reactions - "Loved an image", "Liked an image", etc.
  { pattern: /^Loved an image\.?$/i, emoji: '❤️', isImageReaction: true },
  { pattern: /^Liked an image\.?$/i, emoji: '👍', isImageReaction: true },
  { pattern: /^Disliked an image\.?$/i, emoji: '👎', isImageReaction: true },
  { pattern: /^Laughed at an image\.?$/i, emoji: '😂', isImageReaction: true },
  { pattern: /^Emphasized an image\.?$/i, emoji: '‼️', isImageReaction: true },
  { pattern: /^Questioned an image\.?$/i, emoji: '❓', isImageReaction: true },
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
  isImageReaction: boolean;
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
  for (const { pattern, emoji, isImageReaction } of REACTION_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      // match[1] will be the quoted text if it exists, otherwise undefined
      return { emoji, originalText: match[1] || null, isImageReaction: isImageReaction || false };
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
  attachments?: { isImage: boolean }[];
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

  // Helper to check if a message has image attachments
  const hasImageAttachment = (msg: T): boolean => {
    return msg.attachments?.some(a => a.isImage) ?? false;
  };

  // Helper to add reaction to a message
  const addReactionToMessage = (index: number, emoji: string, sender: string, isMe: boolean) => {
    const currentReactions = getReactions(regularMessages[index]);
    const newReaction: Reaction = { emoji, sender, isMe };
    
    const isDuplicate = currentReactions.some(
      r => r.emoji === newReaction.emoji && r.sender === newReaction.sender
    );
    
    if (!isDuplicate) {
      regularMessages[index] = setReactions(regularMessages[index], [...currentReactions, newReaction]);
    }
  };

  // Second pass: attach text-based reactions to their original messages
  for (const { reaction, sender, isMe } of reactionsList) {
    const msgIsMe = (m: T) => m.isMe ?? m.isFromMe ?? false;

    if (reaction.isImageReaction) {
      // Image reaction - find the most recent message with an image from someone else
      for (let i = regularMessages.length - 1; i >= 0; i--) {
        if (msgIsMe(regularMessages[i]) !== isMe && hasImageAttachment(regularMessages[i])) {
          addReactionToMessage(i, reaction.emoji, sender, isMe);
          break;
        }
      }
    } else if (reaction.originalText) {
      // Try to find a message that matches (partial match since reactions often truncate)
      // Normalize whitespace (newlines, multiple spaces) to single space for comparison
      const normalizeText = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').replace(/\.\.\.?$/, '').trim();
      const originalNorm = normalizeText(reaction.originalText);

      for (const msg of regularMessages) {
        const msgNorm = normalizeText(msg.text);
        // Check if message contains the reaction target or vice versa
        if (msgNorm.includes(originalNorm) || originalNorm.includes(msgNorm.slice(0, 30))) {
          const index = regularMessages.indexOf(msg);
          if (index !== -1) {
            addReactionToMessage(index, reaction.emoji, sender, isMe);
          }
          break;
        }
      }
    } else {
      // Reaction without specific text - attach to the most recent message from someone else
      for (let i = regularMessages.length - 1; i >= 0; i--) {
        if (msgIsMe(regularMessages[i]) !== isMe) {
          addReactionToMessage(i, reaction.emoji, sender, isMe);
          break;
        }
      }
    }
  }

  return regularMessages;
}

