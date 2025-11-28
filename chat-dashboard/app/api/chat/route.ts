/**
 * Chat API Route
 * Uses OpenAI GPT-4o for chat with function calling
 */

import OpenAI from 'openai';
import { getElasticsearchClient, type SearchResult } from '@/lib/elasticsearch';
import { getEmbeddingsClient } from '@/lib/embeddings';

// Load environment variables
import 'dotenv/config';

// Allow streaming responses up to 60 seconds
export const maxDuration = 60;

// Initialize OpenAI client with API key from env
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Format search results for display with chunk ID links
function formatResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return 'No messages found matching your search.';
  }

  const lines: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const timestamp = new Date(r.document.timestamp);
    const resultNum = i + 1;

    const header = r.document.chat_name
      ? `${r.document.chat_name} (${r.document.participants.join(', ')})`
      : r.document.participants.join(', ');

    // Use the Elasticsearch document ID for direct linking
    const chunkLink = `/search?chunk=${encodeURIComponent(r.id)}`;

    lines.push(`**Result ${resultNum}** — 📱 ${header} — 🕐 ${timestamp.toLocaleDateString()}`);
    lines.push(`🔗 Link: \`${chunkLink}\``);
    if (r.document.has_image) lines.push('📷 Contains image');
    lines.push('');
    lines.push('```');
    lines.push(r.document.text);
    lines.push('```');
    lines.push('');
  }

  // Add citation instructions for the model
  lines.push('\n---');
  lines.push('**When citing results in your response, include the link path (e.g., `/search?chunk=...`) so users can click to view the original message.**');

  return lines.join('\n');
}

// Tool definitions for OpenAI
const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_messages',
      description: `Search iMessages using natural language. Combines semantic search (understands meaning) with keyword search (exact matches).
        
Use this for:
- Finding conversations about a topic
- Looking up what someone said
- Searching by meaning, not just keywords`,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural language search query (e.g., "dinner plans with John", "photos from the beach trip")',
          },
          sender: {
            type: 'string',
            description: 'Filter by message sender name',
          },
          chatName: {
            type: 'string',
            description: 'Filter by group chat name',
          },
          isGroupChat: {
            type: 'boolean',
            description: 'True for group chats only, false for DMs only',
          },
          startDate: {
            type: 'string',
            description: 'Start date filter (ISO format: YYYY-MM-DD)',
          },
          endDate: {
            type: 'string',
            description: 'End date filter (ISO format: YYYY-MM-DD)',
          },
          hasImage: {
            type: 'boolean',
            description: 'Filter to messages with images',
          },
          limit: {
            type: 'number',
            description: 'Max results to return (default 10)',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'exact_search',
      description: `Precise keyword/phrase search WITHOUT semantic matching. Use this when you need exact text matches.
        
Use this for:
- Finding exact phrases someone said (e.g., "let's get dinner")
- Searching for specific words or names
- When semantic search returns irrelevant results
- Browsing messages by filters (sender, date, etc.)`,
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: 'Keywords to search for (all words must be present)',
          },
          exactPhrase: {
            type: 'string',
            description: 'Exact phrase to match (use for precise quotes)',
          },
          sender: {
            type: 'string',
            description: 'Filter by sender name',
          },
          chatName: {
            type: 'string',
            description: 'Filter by group chat name',
          },
          isGroupChat: {
            type: 'boolean',
            description: 'True for group chats, false for DMs',
          },
          startDate: {
            type: 'string',
            description: 'Start date (ISO format: YYYY-MM-DD)',
          },
          endDate: {
            type: 'string',
            description: 'End date (ISO format: YYYY-MM-DD)',
          },
          hasImage: {
            type: 'boolean',
            description: 'Filter to messages with images',
          },
          sortBy: {
            type: 'string',
            enum: ['relevance', 'newest', 'oldest'],
            description: 'How to sort results (default: relevance)',
          },
          limit: {
            type: 'number',
            description: 'Max results (default 10)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analytics_query',
      description: `Get aggregate statistics and trends from message data. Use for counting, trends over time, and distributions.

Use this for:
- "How many messages did I send to X?"
- "Who do I text the most?"
- "How has my messaging changed over time?"
- "What time of day do I message most?"

Do NOT use for finding specific message content - use search_messages instead.

STRUCTURED MODE (preferred): Use aggregationType + field parameters.
RAW MODE: Use rawAggregation for complex nested queries.`,
      parameters: {
        type: 'object',
        properties: {
          aggregationType: {
            type: 'string',
            enum: ['date_histogram', 'terms', 'stats', 'count'],
            description: 'Type of aggregation: date_histogram (trends over time), terms (top values), stats (numeric statistics), count (simple count)',
          },
          field: {
            type: 'string',
            enum: ['timestamp', 'sender', 'chat_name', 'hour_of_day', 'day_of_week', 'month', 'year'],
            description: 'Field to aggregate on',
          },
          interval: {
            type: 'string',
            enum: ['day', 'week', 'month', 'year'],
            description: 'Time interval for date_histogram aggregations',
          },
          query: {
            type: 'string',
            description: 'Optional text filter (e.g., messages containing "dinner")',
          },
          sender: {
            type: 'string',
            description: 'Filter by sender name',
          },
          chatName: {
            type: 'string',
            description: 'Filter by group chat name',
          },
          startDate: {
            type: 'string',
            description: 'Start date filter (ISO format: YYYY-MM-DD)',
          },
          endDate: {
            type: 'string',
            description: 'End date filter (ISO format: YYYY-MM-DD)',
          },
          size: {
            type: 'number',
            description: 'Max buckets to return (default 20, max 100)',
          },
          rawAggregation: {
            type: 'object',
            description: 'Raw Elasticsearch aggregation DSL for complex queries (advanced use)',
          },
          rawQuery: {
            type: 'object',
            description: 'Raw Elasticsearch query DSL (advanced use)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'render_chart',
      description: `Render data as an inline chart visualization. 

CRITICAL: You MUST pass the actual data array from analytics_query results. The 'data' parameter must contain the actual data points - you cannot reference them, you must include them.

Example - after analytics_query returns buckets like:
  [{"key": "2024-01", "label": "Jan 2024", "doc_count": 42}, ...]

You must call render_chart with:
  data: [{"label": "Jan 2024", "count": 42}, {"label": "Feb 2024", "count": 38}, ...]
  xKey: "label"
  yKey: "count"`,
      parameters: {
        type: 'object',
        properties: {
          chartType: {
            type: 'string',
            enum: ['line', 'bar', 'area', 'pie'],
            description: 'Type of chart to render',
          },
          title: {
            type: 'string',
            description: 'Chart title (be descriptive)',
          },
          data: {
            type: 'array',
            items: {
              type: 'object',
            },
            description: 'REQUIRED: The actual array of data points from analytics_query. Must include all data points, e.g., [{"label": "Jan 2024", "count": 42}, {"label": "Feb 2024", "count": 38}]',
          },
          xKey: {
            type: 'string',
            description: 'Key in data objects for x-axis values (e.g., "label")',
          },
          yKey: {
            type: 'string',
            description: 'Key in data objects for y-axis values (e.g., "count", "doc_count")',
          },
          xLabel: {
            type: 'string',
            description: 'Label for x-axis',
          },
          yLabel: {
            type: 'string',
            description: 'Label for y-axis',
          },
        },
        required: ['chartType', 'title', 'data', 'xKey', 'yKey'],
      },
    },
  },
];

// Execute tool calls
async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  const es = getElasticsearchClient();
  const embeddings = getEmbeddingsClient();

  try {
    if (name === 'search_messages') {
      const { query, sender, chatName, isGroupChat, startDate, endDate, hasImage, limit = 10 } = args as {
        query: string;
        sender?: string;
        chatName?: string;
        isGroupChat?: boolean;
        startDate?: string;
        endDate?: string;
        hasImage?: boolean;
        limit?: number;
      };

      // Generate embedding for semantic search
      const queryEmbedding = await embeddings.embed(query);

      const results = await es.hybridSearch({
        keywordQuery: query,
        queryEmbedding,
        filters: {
          sender,
          chat_name: chatName,
          is_group_chat: isGroupChat,
          is_dm: isGroupChat === false ? true : undefined,
          timestamp_gte: startDate,
          timestamp_lte: endDate,
          has_image: hasImage,
        },
        limit,
      });

      return formatResults(results);
    }

    if (name === 'exact_search') {
      const { keyword, exactPhrase, sender, chatName, isGroupChat, startDate, endDate, hasImage, sortBy, limit = 10 } = args as {
        keyword?: string;
        exactPhrase?: string;
        sender?: string;
        chatName?: string;
        isGroupChat?: boolean;
        startDate?: string;
        endDate?: string;
        hasImage?: boolean;
        sortBy?: 'relevance' | 'newest' | 'oldest';
        limit?: number;
      };

      const results = await es.exactSearch({
        keyword,
        exactPhrase,
        filters: {
          sender,
          chat_name: chatName,
          is_group_chat: isGroupChat,
          is_dm: isGroupChat === false ? true : undefined,
          timestamp_gte: startDate,
          timestamp_lte: endDate,
          has_image: hasImage,
        },
        sortBy,
        limit,
      });

      return formatResults(results);
    }

    if (name === 'analytics_query') {
      const { 
        aggregationType, 
        field, 
        interval, 
        query, 
        sender, 
        chatName, 
        startDate, 
        endDate, 
        size = 20,
        rawAggregation,
        rawQuery,
      } = args as {
        aggregationType?: 'date_histogram' | 'terms' | 'stats' | 'count';
        field?: 'timestamp' | 'sender' | 'chat_name' | 'hour_of_day' | 'day_of_week' | 'month' | 'year';
        interval?: 'day' | 'week' | 'month' | 'year';
        query?: string;
        sender?: string;
        chatName?: string;
        startDate?: string;
        endDate?: string;
        size?: number;
        rawAggregation?: Record<string, unknown>;
        rawQuery?: Record<string, unknown>;
      };

      const filters = {
        sender,
        chat_name: chatName,
        timestamp_gte: startDate,
        timestamp_lte: endDate,
      };

      // RAW MODE: Use custom aggregation
      if (rawAggregation) {
        const result = await es.runRawAggregation({
          aggregation: rawAggregation,
          query: rawQuery,
          filters,
        });
        return JSON.stringify(result, null, 2);
      }

      // STRUCTURED MODE
      if (aggregationType === 'count') {
        const result = await es.getCount({ query, filters });
        return JSON.stringify({ type: 'count', ...result }, null, 2);
      }

      if (aggregationType === 'date_histogram') {
        const result = await es.aggregateByDate({
          interval: interval || 'month',
          query,
          filters,
          size: Math.min(size, 100),
        });
        return JSON.stringify(result, null, 2);
      }

      if (aggregationType === 'terms' && field) {
        if (!['sender', 'chat_name', 'day_of_week', 'hour_of_day', 'year', 'month'].includes(field)) {
          return JSON.stringify({ error: `Invalid field for terms aggregation: ${field}` });
        }
        const result = await es.aggregateByField({
          field: field as 'sender' | 'chat_name' | 'day_of_week' | 'hour_of_day' | 'year' | 'month',
          query,
          filters,
          size: Math.min(size, 100),
        });
        return JSON.stringify(result, null, 2);
      }

      if (aggregationType === 'stats' && field) {
        if (!['hour_of_day', 'message_count', 'participant_count'].includes(field)) {
          return JSON.stringify({ error: `Invalid field for stats aggregation: ${field}` });
        }
        const result = await es.getStats_agg({
          field: field as 'hour_of_day' | 'message_count' | 'participant_count',
          query,
          filters,
        });
        return JSON.stringify(result, null, 2);
      }

      return JSON.stringify({ error: 'Invalid aggregation configuration. Specify aggregationType and required fields.' });
    }

    if (name === 'render_chart') {
      const { chartType, title, data, xKey, yKey, xLabel, yLabel } = args as {
        chartType: 'line' | 'bar' | 'area' | 'pie';
        title: string;
        data: Array<Record<string, unknown>>;
        xKey: string;
        yKey: string;
        xLabel?: string;
        yLabel?: string;
      };

      // Output a special fenced block that the frontend will parse and render as a chart
      const chartConfig = {
        chartType,
        title,
        data,
        xKey,
        yKey,
        xLabel,
        yLabel,
      };

      return `:::chart\n${JSON.stringify(chartConfig)}\n:::`;
    }

    return `Unknown tool: ${name}`;
  } catch (error) {
    console.error('Tool execution error:', error);
    return `Error executing search: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export async function POST(req: Request) {
  const { messages } = await req.json();

  // Generate current date context for temporal query understanding
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  const systemPrompt = `Current date and time: ${dateStr}, ${timeStr}

# You are The Archivist

A world-class iMessage historian and investigative analyst. You operate over a semantic-search database of iMessages indexed with rich metadata: sender, recipients, timestamps, DM/group classification, thread IDs, semantic embeddings, and conversation context.

Your mission: **Uncover the complete, highest-fidelity truth** behind any query about people, relationships, events, inside jokes, group dynamics, or patterns in the user's iMessage history.

---

## How You Work — IMPORTANT

You think out loud and work iteratively. For every query, follow this pattern:

### 1. PLAN FIRST (Always start with this)
Before searching, briefly share your thinking:
- What is the user really asking?
- What search strategies will you try?
- What variations, aliases, or angles should you explore?

Write 1-3 sentences of your initial plan. This helps the user understand your approach.

### 2. SEARCH AND NARRATE
As you search:
- Explain what you're searching for and why
- After getting results, share key observations ("Interesting — I found X, which suggests Y...")
- Identify gaps: "I haven't found Z yet, let me try another approach..."

### 3. ITERATE
Based on results:
- Decide what additional searches are needed
- Explain your reasoning ("The results mention 'DDS' but I should also check for the full name...")
- Keep searching until you've exhausted relevant angles

### 4. SYNTHESIZE
Once you have enough evidence:
- Provide a clear, narrative summary
- Include a timeline if relevant
- Cite specific messages with links
- Note any remaining uncertainties

---

## Core Directives

### Investigate Deeply
Issue **as many search queries as you need**. Never stop at the first answer — dig until the narrative is complete.

### Iterate Aggressively  
After each search, ask: What context is still missing? What new questions does this raise? What alternative phrasings should I try?

### Cross-Reference Sources
Compare group chats vs DMs. Detect contradictions. Identify first appearances. Track evolution over time.

### Prioritize Chronology
Build timelines. Identify turning points. Surface key quotes. Explain causality.

### Exhaust All Angles
For nicknames or evolving terms, search every spelling and alias. Use both semantic AND exact searches.

### Never Hallucinate
All claims trace to retrieved messages. If unsure, search again. Label speculation clearly.

---

## Available Tools

**search_messages** — Semantic + keyword hybrid search. Understands meaning.
- Best for: finding conversations about topics, understanding vibes, discovering related discussions

**exact_search** — Precise keyword/phrase matching, no semantic interpretation.
- Best for: exact quotes, specific names, first occurrences, when semantic returns noise

**analytics_query** — Get aggregate data (counts, trends, distributions)
- Best for: "How many messages?", "Who do I text most?", "How has texting changed over time?"
- NOT for finding specific message content

**render_chart** — Visualize data inline as charts
- Use AFTER getting data from analytics_query
- CRITICAL: You must pass the actual data array from analytics_query in the 'data' parameter
- Transform buckets: [{key, label, doc_count}] → [{label, count}] for the chart
- Choose: line/area for time series, bar for rankings, pie for proportions

### When to use analytics_query vs search tools:
- "How many messages did I send?" → analytics_query (count)
- "What did I say about X?" → search_messages (content)
- "Who do I text most?" → analytics_query (terms on sender)
- "Show messages from John" → search_messages (retrieval)
- "How has texting changed over time?" → analytics_query (date_histogram)

### Analytics query modes:
**Structured mode** (preferred):
- aggregationType: date_histogram | terms | stats | count
- field: timestamp, sender, chat_name, hour_of_day, day_of_week, month, year
- interval: day, week, month, year (for date_histogram)

**Raw mode** (for complex queries):
- Use rawAggregation for nested aggregations like "by day of week, sub-grouped by hour"

### Visualization best practices:
1. Always analyze data first - share insights before charting
2. When calling render_chart, you MUST pass the data array with actual values:
   - Get buckets from analytics_query: [{"key": "2024-01", "label": "Jan 2024", "doc_count": 42}, ...]
   - Pass to render_chart: data: [{"label": "Jan 2024", "count": 42}, ...], xKey: "label", yKey: "count"
3. Choose chart type: line/area for time series, bar for rankings, pie for proportions
4. Keep to ~20 data points for readability

---

## Search Strategy Tips

- **Start broad, then narrow**: Semantic search first, then exact search for specifics
- **Try multiple phrasings**: "beach trip", "going to the beach", "ocean", "vacation"
- **Use filters strategically**: Date ranges, sender, group chat filters
- **Increase limits**: For historical investigations, use limit: 15-20
- **Check both DMs and group chats**: Different perspectives on same topics

---

## Citing Results — CRITICAL

Each result includes a link like \`/search?chunk=abc123\`. You MUST include these:
- Reference by number: "In Result 3..."
- Include the link: "...John mentioned the trip (\`/search?chunk=abc123\`)"

---

## Temporal Queries

Convert relative times to ISO dates (YYYY-MM-DD):
- "today" = ${now.toISOString().split('T')[0]}
- "yesterday" = previous calendar day
- "this week" = most recent Sunday to today
- "last week" = 7 days before most recent Sunday
- "this month" = 1st of current month to today
- "last month" = entire previous calendar month

---

## Response Style

**CRITICAL: Always output some text before your first tool call.**

Good example:
"I'll investigate the history of your DDS group chat. Let me start by searching for mentions of 'DDS' to understand when it first appeared and how it evolved..."
[then make tool call]

Bad example:
[immediately make tool call with no explanation]

After each search, share observations before the next search. Build the narrative incrementally. Be conversational but thorough.`;

  // Build messages for OpenAI
  const chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m: { role: string; content: string }) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ];

  // Create streaming response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        let continueLoop = true;
        
        while (continueLoop) {
          // Make a streaming request that can include both content AND tool calls
          const streamResponse = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: chatMessages,
            tools,
            stream: true,
          });

          // Collect the full response while streaming content
          let fullContent = '';
          const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
          
          for await (const chunk of streamResponse) {
            const choice = chunk.choices[0];
            if (!choice) continue;

            // Stream any content immediately
            const content = choice.delta?.content;
            if (content) {
              fullContent += content;
              controller.enqueue(encoder.encode(content));
            }

            // Collect tool call deltas
            const deltaToolCalls = choice.delta?.tool_calls;
            if (deltaToolCalls) {
              for (const tc of deltaToolCalls) {
                const existing = toolCalls.get(tc.index) || { id: '', name: '', arguments: '' };
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name = tc.function.name;
                if (tc.function?.arguments) existing.arguments += tc.function.arguments;
                toolCalls.set(tc.index, existing);
              }
            }
          }

          // If no tool calls, we're done
          if (toolCalls.size === 0) {
            continueLoop = false;
            break;
          }

          // Add the assistant message with tool calls to history
          const toolCallsArray = Array.from(toolCalls.values()).map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          }));

          chatMessages.push({
            role: 'assistant',
            content: fullContent || null,
            tool_calls: toolCallsArray,
          });

          // Execute each tool call
          for (const tc of toolCallsArray) {
            const args = JSON.parse(tc.function.arguments);
            
            // Log tool call details
            console.log(`[Agent] Tool: ${tc.function.name}`);
            console.log(`[Agent] Args:`, JSON.stringify(args, null, 2));
            
            // Format args for UI display
            const argsList = Object.entries(args)
              .map(([key, value]) => {
                // For arrays (like data), show count instead of [object Object]
                if (Array.isArray(value)) {
                  return `  • ${key}: [${value.length} items]`;
                }
                // For objects, stringify them
                if (typeof value === 'object' && value !== null) {
                  return `  • ${key}: ${JSON.stringify(value)}`;
                }
                return `  • ${key}: \`${value}\``;
              })
              .join('\n');
            
            // Stream tool info with details
            controller.enqueue(encoder.encode(`\n\n🔍 **Searching**: \`${tc.function.name}\`\n${argsList}\n`));
            
            const startTime = Date.now();
            const result = await executeTool(tc.function.name, args);
            const duration = Date.now() - startTime;
            console.log(`[Agent] Result (${duration}ms): ${result.substring(0, 200)}...`);
            
            // Stream timing info
            controller.enqueue(encoder.encode(`⏱️ *${duration}ms*\n\n`));

            // For render_chart, stream the chart block directly to the client
            // so it appears inline in the chat
            if (tc.function.name === 'render_chart') {
              controller.enqueue(encoder.encode(`\n${result}\n\n`));
            }

            // Add tool result to messages
            chatMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: result,
            });
          }
        }

        controller.close();
      } catch (error) {
        console.error('Chat error:', error);
        controller.enqueue(encoder.encode(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
    },
  });
}
