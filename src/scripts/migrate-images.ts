#!/usr/bin/env node
/**
 * Image Migration Script
 * Adds image embeddings to existing chunks without full reindex
 * 
 * Usage: pnpm images:migrate [--dry-run] [--limit 100]
 */

import 'dotenv/config';
import { existsSync } from 'fs';
import { getElasticsearchDB } from '../db/elasticsearch.js';
import { getImageReader } from '../indexer/images.js';
import { getCLIPClient, preloadCLIPModel } from '../embeddings/clip.js';
import { getStateManager } from '../indexer/state.js';
import { log, formatNumber, ProgressBar } from '../utils/progress.js';

interface MigrationOptions {
  dryRun: boolean;
  limit?: number;
  batchSize: number;
}

async function migrate(options: MigrationOptions) {
  const { dryRun, limit, batchSize } = options;
  
  console.log('');
  console.log('╔═══════════════════════════════════════╗');
  console.log('║   iMessage MCP - Image Migration      ║');
  console.log('╚═══════════════════════════════════════╝');
  console.log('');
  
  if (dryRun) {
    log('Migration', '🔍 DRY RUN - No changes will be made');
  }
  
  // Initialize clients
  const esDB = getElasticsearchDB();
  const imageReader = getImageReader();
  const clipClient = getCLIPClient();
  const stateManager = getStateManager();
  
  // Check Elasticsearch health
  const healthy = await esDB.healthCheck();
  if (!healthy) {
    throw new Error('Elasticsearch is not reachable. Run `pnpm es:start` first.');
  }
  
  // Get ES stats
  const stats = await esDB.getStats();
  if (!stats || stats.documentCount === 0) {
    log('Migration', 'No documents found in Elasticsearch. Run `pnpm index` first.', 'warn');
    return;
  }
  
  log('Migration', `Found ${formatNumber(stats.documentCount)} documents in Elasticsearch`);
  
  // Open image reader
  imageReader.open();
  stateManager.open();
  
  // Get all chunk records from state to get message rowids
  const chunkRecords = stateManager.getAllChunkRecords();
  log('Migration', `Found ${formatNumber(chunkRecords.length)} chunk records in state`);
  
  if (chunkRecords.length === 0) {
    log('Migration', 'No chunk records found. The state database may be empty.', 'warn');
    imageReader.close();
    stateManager.close();
    return;
  }
  
  // Pre-load CLIP model
  log('Migration', 'Loading CLIP model...');
  await preloadCLIPModel();
  
  // Find chunks that have images
  log('Migration', 'Scanning for chunks with images...');
  
  const chunksWithImages: Array<{
    chunkId: string;
    imagePaths: string[];
  }> = [];
  
  let scanned = 0;
  const scanProgress = new ProgressBar('Scanning', chunkRecords.length);
  
  for (const record of chunkRecords) {
    if (limit && chunksWithImages.length >= limit) break;
    
    const messageRowids = JSON.parse(record.messageRowids) as number[];
    const imagePaths: string[] = [];
    
    for (const rowid of messageRowids) {
      const images = imageReader.getImagesForMessage(rowid);
      for (const img of images) {
        if (existsSync(img.filename)) {
          imagePaths.push(img.filename);
        }
      }
    }
    
    if (imagePaths.length > 0) {
      chunksWithImages.push({
        chunkId: record.documentId,
        imagePaths,
      });
    }
    
    scanned++;
    scanProgress.update(scanned);
  }
  
  scanProgress.complete();
  
  log('Migration', `Found ${formatNumber(chunksWithImages.length)} chunks with images`);
  
  if (chunksWithImages.length === 0) {
    log('Migration', 'No images to process!', 'success');
    imageReader.close();
    stateManager.close();
    return;
  }
  
  if (dryRun) {
    log('Migration', `Would update ${chunksWithImages.length} documents`);
    log('Migration', 'Sample chunk IDs:', 'info');
    for (const chunk of chunksWithImages.slice(0, 5)) {
      console.log(`  - ${chunk.chunkId} (${chunk.imagePaths.length} images)`);
    }
    imageReader.close();
    stateManager.close();
    return;
  }
  
  // Process in batches
  log('Migration', 'Generating CLIP embeddings and updating documents...');
  
  let processed = 0;
  let updated = 0;
  let failed = 0;
  
  const progress = new ProgressBar('Migrating', chunksWithImages.length);
  
  for (let i = 0; i < chunksWithImages.length; i += batchSize) {
    const batch = chunksWithImages.slice(i, i + batchSize);
    
    for (const chunk of batch) {
      try {
        // Generate CLIP embedding for the first image
        const embedding = await clipClient.embedImage(chunk.imagePaths[0]);
        
        if (embedding) {
          // Update the document in Elasticsearch
          await updateDocument(esDB, chunk.chunkId, {
            has_image: true,
            has_attachment: true,
            image_embedding: embedding,
          });
          updated++;
        } else {
          // Just mark as having image (embedding failed)
          await updateDocument(esDB, chunk.chunkId, {
            has_image: true,
            has_attachment: true,
          });
          updated++;
        }
      } catch (err) {
        log('Migration', `Failed to process chunk ${chunk.chunkId}: ${err}`, 'error');
        failed++;
      }
      
      processed++;
      progress.update(processed);
    }
  }
  
  progress.complete();
  
  // Cleanup
  imageReader.close();
  stateManager.close();
  
  // Summary
  console.log('');
  console.log('╔═══════════════════════════════════════╗');
  console.log('║         Migration Complete!           ║');
  console.log('╚═══════════════════════════════════════╝');
  console.log('');
  console.log(`  Chunks scanned:  ${formatNumber(scanned)}`);
  console.log(`  Chunks updated:  ${formatNumber(updated)}`);
  console.log(`  Chunks failed:   ${formatNumber(failed)}`);
  console.log('');
}

/**
 * Update a document in Elasticsearch with partial update
 */
async function updateDocument(
  esDB: ReturnType<typeof getElasticsearchDB>,
  docId: string,
  updates: {
    has_image?: boolean;
    has_attachment?: boolean;
    image_embedding?: number[];
  }
) {
  // Access the underlying ES client through the public interface
  // We need to do a partial update, so we'll use the hybridSearch to check existence
  // then reindex with the updates
  
  const existingDoc = await esDB.getDocument(docId);
  if (!existingDoc) {
    throw new Error(`Document ${docId} not found`);
  }
  
  // Merge updates with existing document
  const updatedDoc = {
    ...existingDoc,
    ...updates,
  };
  
  // Reindex the document (this is a full replace but preserves all existing fields)
  await esDB.indexDocuments([{ id: docId, ...updatedDoc }], false);
}

// Parse command line arguments
function parseArgs(): MigrationOptions {
  const args = process.argv.slice(2);
  
  const options: MigrationOptions = {
    dryRun: false,
    batchSize: 10,
  };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--limit':
        options.limit = parseInt(args[++i], 10);
        break;
      case '--batch-size':
        options.batchSize = parseInt(args[++i], 10);
        break;
    }
  }
  
  return options;
}

// Main
const options = parseArgs();
migrate(options).catch(err => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});

