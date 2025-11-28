/**
 * Main indexer orchestrator
 * Coordinates reading messages, chunking, embedding, and storing in Elasticsearch
 */

import { MessageReader, getMessageReader } from './messages.js';
import { ContactResolver, getContactResolver } from './contacts.js';
import { chunkMessages, filterChunks, deduplicateChunks, MessageChunk } from './chunker.js';
import { StateManager, getStateManager } from './state.js';
import { EmbeddingsClient, getEmbeddingsClient } from '../embeddings/openai.js';
import { ElasticsearchDB, getElasticsearchDB, MessageDocument } from '../db/elasticsearch.js';
import { enrichChunks, toESDocument } from './enrichment.js';
import { log, formatNumber } from '../utils/progress.js';

export interface IndexerOptions {
  fullReindex?: boolean;
  batchSize?: number;
  maxMessages?: number;  // Limit total messages to process (for testing)
}

export interface IndexerStats {
  messagesProcessed: number;
  chunksCreated: number;
  chunksIndexed: number;
  duration: number;
}

/**
 * Main indexer class - uses Elasticsearch for storage
 */
export class Indexer {
  private messageReader: MessageReader;
  private contactResolver: ContactResolver;
  private stateManager: StateManager;
  private _embeddingsClient: EmbeddingsClient | null = null;
  private elasticsearchDB: ElasticsearchDB;
  
  constructor() {
    this.messageReader = getMessageReader();
    this.contactResolver = getContactResolver();
    this.stateManager = getStateManager();
    this.elasticsearchDB = getElasticsearchDB();
  }
  
  // Lazy load embeddings client only when needed
  private get embeddingsClient(): EmbeddingsClient {
    if (!this._embeddingsClient) {
      this._embeddingsClient = getEmbeddingsClient();
    }
    return this._embeddingsClient;
  }
  
  /**
   * Run the indexing process
   */
  async run(options: IndexerOptions = {}): Promise<IndexerStats> {
    const startTime = Date.now();
    const { fullReindex = false, batchSize = 10000, maxMessages } = options;
    
    log('Indexer', 'Starting indexing process...');
    
    // Check Elasticsearch health
    const esHealthy = await this.elasticsearchDB.healthCheck();
    if (!esHealthy) {
      throw new Error('Elasticsearch is not reachable. Run `pnpm es:start` first.');
    }
    
    // Initialize components
    this.stateManager.open();
    this.contactResolver.load();
    this.messageReader.open();
    
    // Handle full reindex
    if (fullReindex) {
      log('Indexer', 'Full reindex requested, clearing state...');
      this.stateManager.reset();
      await this.elasticsearchDB.clear();
    }
    
    // Get current state
    const state = this.stateManager.getState();
    const existingHashes = this.stateManager.getIndexedChunkHashes();
    
    log('Indexer', `Last indexed rowid: ${state.lastMessageRowid}`);
    
    // Check for new messages
    const newMessageCount = this.messageReader.getNewMessageCount(state.lastMessageRowid);
    if (newMessageCount === 0) {
      log('Indexer', 'No new messages to index', 'success');
      return {
        messagesProcessed: 0,
        chunksCreated: 0,
        chunksIndexed: 0,
        duration: Date.now() - startTime,
      };
    }
    
    log('Indexer', `Found ${formatNumber(newMessageCount)} new messages since rowid ${state.lastMessageRowid}`);
    
    // Process in batches
    let totalMessagesProcessed = 0;
    let totalChunksCreated = 0;
    let totalChunksIndexed = 0;
    let lastRowid = state.lastMessageRowid;
    
    while (true) {
      // Check if we've hit the limit
      if (maxMessages && totalMessagesProcessed >= maxMessages) {
        log('Indexer', `Reached message limit of ${maxMessages}`);
        break;
      }
      
      // Calculate how many messages to fetch in this batch
      const remaining = maxMessages ? maxMessages - totalMessagesProcessed : batchSize;
      const fetchSize = Math.min(batchSize, remaining);
      
      // Read a batch of messages
      const messages = this.messageReader.readMessages(lastRowid, fetchSize);
      if (messages.length === 0) break;
      
      log('Indexer', `Processing batch of ${messages.length} messages...`);
      
      // Chunk messages
      const chunks = chunkMessages(messages, this.contactResolver);
      const filteredChunks = filterChunks(chunks);
      const uniqueChunks = deduplicateChunks(filteredChunks, existingHashes);
      
      log('Indexer', `Created ${filteredChunks.length} chunks, ${uniqueChunks.length} are new`);
      
      if (uniqueChunks.length > 0) {
        // Enrich chunks with derived fields
        const enrichedChunks = enrichChunks(uniqueChunks);
        
        // Generate embeddings
        const texts = enrichedChunks.map(c => c.text);
        const embeddingResults = await this.embeddingsClient.embedBatch(texts, true);
        
        // Convert to Elasticsearch documents
        const esDocuments = enrichedChunks.map((chunk, i) => 
          toESDocument(chunk, embeddingResults[i].embedding)
        );
        
        // Store in Elasticsearch
        await this.elasticsearchDB.indexDocuments(esDocuments, true);
        
        // Record in state
        const now = Math.floor(Date.now() / 1000);
        this.stateManager.recordChunks(
          uniqueChunks.map(chunk => ({
            chunkHash: chunk.id,
            messageRowids: chunk.messageRowids,
            documentId: chunk.id, // ES document ID
            createdAt: now,
          }))
        );
        
        // Add to existing hashes for dedup within this run
        for (const chunk of uniqueChunks) {
          existingHashes.add(chunk.id);
        }
        
        totalChunksIndexed += uniqueChunks.length;
      }
      
      totalMessagesProcessed += messages.length;
      totalChunksCreated += filteredChunks.length;
      lastRowid = messages[messages.length - 1].rowid;
      
      // Update state
      this.stateManager.updateState({
        lastMessageRowid: lastRowid,
        lastIndexedAt: Math.floor(Date.now() / 1000),
        totalMessagesIndexed: state.totalMessagesIndexed + totalMessagesProcessed,
        totalChunksCreated: state.totalChunksCreated + totalChunksIndexed,
      });
    }
    
    const duration = Date.now() - startTime;
    
    log('Indexer', `Complete! Processed ${formatNumber(totalMessagesProcessed)} messages, indexed ${formatNumber(totalChunksIndexed)} chunks in ${(duration / 1000).toFixed(1)}s`, 'success');
    
    // Cleanup
    this.messageReader.close();
    this.stateManager.close();
    
    return {
      messagesProcessed: totalMessagesProcessed,
      chunksCreated: totalChunksCreated,
      chunksIndexed: totalChunksIndexed,
      duration,
    };
  }
  
  /**
   * Get current indexing status
   */
  async getStatus(): Promise<{
    state: ReturnType<StateManager['getState']>;
    elasticsearch: Awaited<ReturnType<ElasticsearchDB['getStats']>>;
    messageStats: ReturnType<MessageReader['getStats']>;
    pendingMessages: number;
  }> {
    this.stateManager.open();
    this.messageReader.open();
    
    const state = this.stateManager.getState();
    const messageStats = this.messageReader.getStats();
    const esStats = await this.elasticsearchDB.getStats();
    
    const pendingMessages = messageStats 
      ? this.messageReader.getNewMessageCount(state.lastMessageRowid)
      : 0;
    
    this.messageReader.close();
    this.stateManager.close();
    
    return {
      state,
      elasticsearch: esStats,
      messageStats: messageStats!,
      pendingMessages,
    };
  }
}

// Export singleton getter
let indexerInstance: Indexer | null = null;

export function getIndexer(): Indexer {
  if (!indexerInstance) {
    indexerInstance = new Indexer();
  }
  return indexerInstance;
}
