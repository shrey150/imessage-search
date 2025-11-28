/**
 * Image serving API
 * Serves local images from the iMessage Attachments directory
 * Converts HEIC/HEIF images to JPEG for browser compatibility
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import sharp from 'sharp';

// Only allow serving images from the Messages attachments directory
const ALLOWED_PATH_PREFIX = `${homedir()}/Library/Messages/Attachments`;

// MIME type mapping
const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.tiff': 'image/tiff',
  '.bmp': 'image/bmp',
};

// Extensions that need conversion to JPEG for browser compatibility
const NEEDS_CONVERSION = ['.heic', '.heif', '.tiff', '.bmp'];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const path = searchParams.get('path');

  if (!path) {
    return new Response('Missing path parameter', { status: 400 });
  }

  // Decode the path
  const decodedPath = decodeURIComponent(path);

  // Security check: only allow serving from Messages Attachments directory
  if (!decodedPath.startsWith(ALLOWED_PATH_PREFIX)) {
    return new Response('Access denied', { status: 403 });
  }

  // Check if file exists
  if (!existsSync(decodedPath)) {
    return new Response('File not found', { status: 404 });
  }

  try {
    const ext = decodedPath.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
    
    // Check if we need to convert the image
    if (NEEDS_CONVERSION.includes(ext)) {
      // Convert to JPEG using sharp
      const convertedBuffer = await sharp(decodedPath)
        .jpeg({ quality: 85 })
        .toBuffer();
      
      return new Response(convertedBuffer, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }

    // Read the file directly for formats browsers support
    const fileBuffer = readFileSync(decodedPath);
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

    return new Response(fileBuffer, {
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Error serving image:', error);
    return new Response('Failed to read file', { status: 500 });
  }
}
