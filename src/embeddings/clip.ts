/**
 * CLIP embeddings client using Transformers.js
 * Generates image and text embeddings for multimodal search
 * 
 * Uses the Xenova/clip-vit-base-patch32 model (512-dim embeddings)
 */

import { pipeline, env, RawImage } from '@xenova/transformers';
import { log, ProgressBar } from '../utils/progress.js';
import { execSync } from 'child_process';
import { existsSync, unlinkSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Disable local model check - always use cache
env.allowLocalModels = false;

// HEIC file extensions that need conversion
const HEIC_EXTENSIONS = ['.heic', '.heif'];

// Configuration
const MODEL_NAME = 'Xenova/clip-vit-base-patch32';
const DIMENSIONS = 512; // CLIP ViT-B/32 produces 512-dim embeddings
const BATCH_SIZE = 10;  // Process images in small batches to avoid memory issues

// Pipeline types from @xenova/transformers (using any to avoid strict typing issues)
type ImageFeatureExtractionPipeline = Awaited<ReturnType<typeof pipeline<'image-feature-extraction'>>>;
type FeatureExtractionPipeline = Awaited<ReturnType<typeof pipeline<'feature-extraction'>>>;

export interface CLIPEmbeddingResult {
  path?: string;
  text?: string;
  embedding: number[];
}

/**
 * CLIP embeddings client for image and text embeddings
 * Uses Transformers.js to run CLIP model in Node.js
 */
export class CLIPClient {
  private imageEmbedder: ImageFeatureExtractionPipeline | null = null;
  private textEmbedder: FeatureExtractionPipeline | null = null;
  private initPromise: Promise<void> | null = null;
  private modelLoaded = false;
  
  /**
   * Initialize the CLIP model (lazy loading)
   * Call this explicitly if you want to pre-warm the model
   */
  async initialize(): Promise<void> {
    if (this.modelLoaded) return;
    
    // Ensure we only initialize once
    if (this.initPromise) {
      return this.initPromise;
    }
    
    this.initPromise = this._loadModel();
    return this.initPromise;
  }
  
  private async _loadModel(): Promise<void> {
    const startTime = Date.now();
    log('CLIP', 'Loading CLIP model (first time may take a few seconds)...');
    
    try {
      // Load both image and text feature extraction pipelines
      // The model will be downloaded and cached on first run
      this.imageEmbedder = await pipeline('image-feature-extraction', MODEL_NAME);
      this.textEmbedder = await pipeline('feature-extraction', MODEL_NAME);
      
      this.modelLoaded = true;
      const loadTime = ((Date.now() - startTime) / 1000).toFixed(1);
      log('CLIP', `Model loaded in ${loadTime}s`, 'success');
    } catch (err) {
      log('CLIP', `Failed to load model: ${err}`, 'error');
      throw err;
    }
  }
  
  /**
   * Generate embedding for a single image file
   * Automatically converts HEIC files to JPEG for compatibility
   */
  async embedImage(imagePath: string): Promise<number[] | null> {
    await this.initialize();
    
    let processPath = imagePath;
    let tempFile: string | null = null;
    
    try {
      // Check if we need to convert HEIC
      const ext = imagePath.toLowerCase().slice(imagePath.lastIndexOf('.'));
      if (HEIC_EXTENSIONS.includes(ext)) {
        tempFile = await this.convertHeicToJpeg(imagePath);
        if (!tempFile) {
          log('CLIP', `Failed to convert HEIC: ${imagePath}`, 'error');
          return null;
        }
        processPath = tempFile;
      }
      
      // Load and process the image
      const image = await RawImage.fromURL(processPath);
      
      // Generate embedding
      const output = await this.imageEmbedder!(image);
      
      // Extract and normalize the embedding
      const embedding = Array.from(output.data as Float32Array);
      return this.normalize(embedding);
    } catch (err) {
      log('CLIP', `Error embedding image ${imagePath}: ${err}`, 'error');
      return null;
    } finally {
      // Clean up temp file
      if (tempFile && existsSync(tempFile)) {
        try {
          unlinkSync(tempFile);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }
  
  /**
   * Convert HEIC file to JPEG using macOS sips command
   * Returns path to temp JPEG file, or null on failure
   */
  private async convertHeicToJpeg(heicPath: string): Promise<string | null> {
    try {
      // Create temp file path
      const tempDir = mkdtempSync(join(tmpdir(), 'clip-'));
      const tempFile = join(tempDir, 'converted.jpg');
      
      // Use macOS sips to convert (fast and reliable)
      execSync(`sips -s format jpeg "${heicPath}" --out "${tempFile}" 2>/dev/null`, {
        timeout: 10000, // 10 second timeout
      });
      
      if (existsSync(tempFile)) {
        return tempFile;
      }
      return null;
    } catch (err) {
      // sips failed - might not be on macOS or file is corrupted
      return null;
    }
  }
  
  /**
   * Generate embedding for text (for text-to-image search)
   */
  async embedText(text: string): Promise<number[] | null> {
    await this.initialize();
    
    try {
      // Generate text embedding
      const output = await this.textEmbedder!(text, { pooling: 'mean', normalize: true });
      
      // Extract the embedding
      const embedding = Array.from(output.data as Float32Array);
      return embedding;
    } catch (err) {
      log('CLIP', `Error embedding text: ${err}`, 'error');
      return null;
    }
  }
  
  /**
   * Generate embeddings for multiple images with batching
   */
  async embedImages(imagePaths: string[], showProgress = false): Promise<CLIPEmbeddingResult[]> {
    await this.initialize();
    
    const results: CLIPEmbeddingResult[] = [];
    const batches = this.createBatches(imagePaths, BATCH_SIZE);
    
    const progress = showProgress ? new ProgressBar('CLIP Images', imagePaths.length) : null;
    let processed = 0;
    
    for (const batch of batches) {
      const batchResults = await this.processBatch(batch);
      results.push(...batchResults);
      
      processed += batch.length;
      progress?.update(processed);
    }
    
    progress?.complete();
    return results;
  }
  
  /**
   * Process a batch of images
   */
  private async processBatch(imagePaths: string[]): Promise<CLIPEmbeddingResult[]> {
    const results: CLIPEmbeddingResult[] = [];
    
    for (const path of imagePaths) {
      const embedding = await this.embedImage(path);
      results.push({
        path,
        embedding: embedding || [],
      });
    }
    
    return results;
  }
  
  /**
   * Normalize a vector to unit length
   */
  private normalize(vector: number[]): number[] {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (magnitude === 0) return vector;
    return vector.map(val => val / magnitude);
  }
  
  /**
   * Split items into batches
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }
  
  /**
   * Get the embedding dimensions
   */
  get dimensions(): number {
    return DIMENSIONS;
  }
  
  /**
   * Get the model name
   */
  get model(): string {
    return MODEL_NAME;
  }
  
  /**
   * Check if the model is loaded
   */
  get isLoaded(): boolean {
    return this.modelLoaded;
  }
}

// Singleton instance
let clientInstance: CLIPClient | null = null;

export function getCLIPClient(): CLIPClient {
  if (!clientInstance) {
    clientInstance = new CLIPClient();
  }
  return clientInstance;
}

/**
 * Pre-warm the CLIP model (useful at server startup)
 */
export async function preloadCLIPModel(): Promise<void> {
  const client = getCLIPClient();
  await client.initialize();
}

