/**
 * Video serving API
 * Serves local videos from the iMessage Attachments directory
 * Supports range requests for proper video streaming
 */

import { existsSync, statSync, createReadStream } from 'fs';
import { homedir } from 'os';

// Only allow serving videos from the Messages attachments directory
const ALLOWED_PATH_PREFIX = `${homedir()}/Library/Messages/Attachments`;

// MIME type mapping for videos
const VIDEO_MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.webm': 'video/webm',
  '.3gp': 'video/3gpp',
  '.3g2': 'video/3gpp2',
};

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
    const mimeType = VIDEO_MIME_TYPES[ext] || 'video/mp4';
    const stat = statSync(decodedPath);
    const fileSize = stat.size;

    // Handle range requests for video streaming
    const range = req.headers.get('range');
    
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      const stream = createReadStream(decodedPath, { start, end });
      
      // Convert Node.js stream to Web ReadableStream
      const webStream = new ReadableStream({
        start(controller) {
          stream.on('data', (chunk) => {
            controller.enqueue(chunk);
          });
          stream.on('end', () => {
            controller.close();
          });
          stream.on('error', (err) => {
            controller.error(err);
          });
        },
        cancel() {
          stream.destroy();
        },
      });

      return new Response(webStream, {
        status: 206,
        headers: {
          'Content-Type': mimeType,
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize.toString(),
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }

    // No range request - return full file
    const stream = createReadStream(decodedPath);
    
    const webStream = new ReadableStream({
      start(controller) {
        stream.on('data', (chunk) => {
          controller.enqueue(chunk);
        });
        stream.on('end', () => {
          controller.close();
        });
        stream.on('error', (err) => {
          controller.error(err);
        });
      },
      cancel() {
        stream.destroy();
      },
    });

    return new Response(webStream, {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': fileSize.toString(),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Error serving video:', error);
    return new Response('Failed to read file', { status: 500 });
  }
}

