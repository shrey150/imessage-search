/**
 * Main indexer orchestrator
 * Coordinates reading messages, chunking, embedding, and storing in Elasticsearch
 */

import { MessageReader, getMessageReader } from './messages.js';
import { ContactResolver, getContactResolver } from './contacts.js';
import { chunkMessages, filterChunks, deduplicateChunks, MessageChunk } from './chunker.js';
import { StateManager, getStateManager } from './state.js';
import { EmbeddingsClient, getEmbeddingsClient } from '../embeddings/openai.js';
import { CLIPClient, getCLIPClient } from '../embeddings/clip.js';
import { ElasticsearchDB, getElasticsearchDB, MessageDocument } from '../db/elasticsearch.js';
import { enrichChunk, toESDocument, EnrichmentOptions } from './enrichment.js';
import { ImageReader, getImageReader, ImageAttachment } from './images.js';
import { log, formatNumber } from '../utils/progress.js';
import { existsSync } from 'fs';

export interface IndexerOptions {
  fullReindex?: boolean;
  batchSize?: number;
  maxMessages?: number;  // Limit total messages to process (for testing)
  skipImages?: boolean;  // Skip image embedding (faster, but no image search)
}

export interface IndexerStats {
  messagesProcessed: number;
  chunksCreated: number;
  chunksIndexed: number;
  imagesProcessed: number;
  duration: number;
}

/**
 * Main indexer class - uses Elasticsearch for storage
 */
export class Indexer {
  private messageReader: MessageReader;
  private contactResolver: ContactResolver;
  private stateManager: StateManager;
  private imageReader: ImageReader;
  private _embeddingsClient: EmbeddingsClient | null = null;
  private _clipClient: CLIPClient | null = null;
  private elasticsearchDB: ElasticsearchDB;
  
  constructor() {
    this.messageReader = getMessageReader();
    this.contactResolver = getContactResolver();
    this.stateManager = getStateManager();
    this.imageReader = getImageReader();
    this.elasticsearchDB = getElasticsearchDB();
  }
  
  // Lazy load embeddings client only when needed
  private get embeddingsClient(): EmbeddingsClient {
    if (!this._embeddingsClient) {
      this._embeddingsClient = getEmbeddingsClient();
    }
    return this._embeddingsClient;
  }
  
  // Lazy load CLIP client only when needed
  private get clipClient(): CLIPClient {
    if (!this._clipClient) {
      this._clipClient = getCLIPClient();
    }
    return this._clipClient;
  }
  
  /**
   * Run the indexing process
   */
  async run(options: IndexerOptions = {}): Promise<IndexerStats> {
    const startTime = Date.now();
    const { fullReindex = false, batchSize = 10000, maxMessages, skipImages = false } = options;
    
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
    this.imageReader.open();
    
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
        imagesProcessed: 0,
        duration: Date.now() - startTime,
      };
    }
    
    log('Indexer', `Found ${formatNumber(newMessageCount)} new messages since rowid ${state.lastMessageRowid}`);
    
    // Pre-warm CLIP model if we're processing images
    if (!skipImages) {
      log('Indexer', 'Pre-loading CLIP model for image embeddings...');
      await this.clipClient.initialize();
    }
    
    // Process in batches
    let totalMessagesProcessed = 0;
    let totalChunksCreated = 0;
    let totalChunksIndexed = 0;
    let totalImagesProcessed = 0;
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
        // Find images for each chunk
        const chunkImageData = skipImages 
          ? uniqueChunks.map(() => ({ hasImage: false, imageEmbedding: undefined }))
          : await this.processChunkImages(uniqueChunks);
        
        const imagesInBatch = chunkImageData.filter(d => d.hasImage).length;
        if (imagesInBatch > 0) {
          log('Indexer', `Found ${imagesInBatch} chunks with images`);
        }
        totalImagesProcessed += imagesInBatch;
        
        // Enrich chunks with derived fields and image data
        const enrichedChunks = uniqueChunks.map((chunk, i) => 
          enrichChunk(chunk, {
            hasImage: chunkImageData[i].hasImage,
            imageEmbedding: chunkImageData[i].imageEmbedding,
          })
        );
        
        // Generate text embeddings
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
    
    log('Indexer', `Complete! Processed ${formatNumber(totalMessagesProcessed)} messages, indexed ${formatNumber(totalChunksIndexed)} chunks (${totalImagesProcessed} with images) in ${(duration / 1000).toFixed(1)}s`, 'success');
    
    // Cleanup
    this.messageReader.close();
    this.imageReader.close();
    this.stateManager.close();
    
    return {
      messagesProcessed: totalMessagesProcessed,
      chunksCreated: totalChunksCreated,
      chunksIndexed: totalChunksIndexed,
      imagesProcessed: totalImagesProcessed,
      duration,
    };
  }
  
  /**
   * Process images for a batch of chunks
   * Returns image data (hasImage, imageEmbedding) for each chunk
   */
  private async processChunkImages(chunks: MessageChunk[]): Promise<Array<{ hasImage: boolean; imageEmbedding?: number[] }>> {
    const results: Array<{ hasImage: boolean; imageEmbedding?: number[] }> = [];
    
    for (const chunk of chunks) {
      // Check if any message in the chunk has an associated image
      const images: ImageAttachment[] = [];
      
      for (const messageRowid of chunk.messageRowids) {
        const messageImages = this.imageReader.getImagesForMessage(messageRowid);
        images.push(...messageImages);
      }
      
      if (images.length === 0) {
        results.push({ hasImage: false });
        continue;
      }
      
      // Filter to images that actually exist on disk
      const existingImages = images.filter(img => existsSync(img.filename));
      
      if (existingImages.length === 0) {
        results.push({ hasImage: false });
        continue;
      }
      
      // Generate CLIP embedding for the first image (most representative)
      // In the future, we could average embeddings or use multiple
      const firstImage = existingImages[0];
      const embedding = await this.clipClient.embedImage(firstImage.filename);
      
      results.push({
        hasImage: true,
        imageEmbedding: embedding || undefined,
      });
    }
    
    return results;
  }
  
  /**
   * Get current indexing status
   */
  async getStatus(): Promise<{
    state: ReturnType<StateManager['getState']>;
    elasticsearch: Awaited<ReturnType<ElasticsearchDB['getStats']>>;
    messageStats: ReturnType<MessageReader['getStats']>;
    imageStats: ReturnType<ImageReader['getStats']>;
    pendingMessages: number;
  }> {
    this.stateManager.open();
    this.messageReader.open();
    this.imageReader.open();
    
    const state = this.stateManager.getState();
    const messageStats = this.messageReader.getStats();
    const imageStats = this.imageReader.getStats();
    const esStats = await this.elasticsearchDB.getStats();
    
    const pendingMessages = messageStats 
      ? this.messageReader.getNewMessageCount(state.lastMessageRowid)
      : 0;
    
    this.messageReader.close();
    this.imageReader.close();
    this.stateManager.close();
    
    return {
      state,
      elasticsearch: esStats,
      messageStats: messageStats!,
      imageStats: imageStats!,
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
