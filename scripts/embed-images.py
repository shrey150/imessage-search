#!/usr/bin/env python3
"""
CLIP embedding script for iMessage images
Generates embeddings for images and stores them in Elasticsearch

Usage:
    python scripts/embed-images.py [--full] [--batch-size 50] [--es-url http://localhost:9200]
"""

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

import numpy as np
import torch
from elasticsearch import Elasticsearch
from PIL import Image
from tqdm import tqdm
from transformers import CLIPModel, CLIPProcessor

# Configuration
DEFAULT_ES_URL = "http://localhost:9200"
DEFAULT_BATCH_SIZE = 50
STATE_FILE = os.path.expanduser("~/.imessage-mcp/image_state.json")
MESSAGES_DB = os.path.expanduser("~/Library/Messages/chat.db")
INDEX_NAME = "imessage_chunks"

# Image file extensions we support
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.tiff', '.bmp'}


def load_state() -> dict:
    """Load embedding state from file"""
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, 'r') as f:
            return json.load(f)
    return {"last_attachment_rowid": 0, "total_images_embedded": 0}


def save_state(state: dict):
    """Save embedding state to file"""
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f)


def mac_to_unix(mac_time: int) -> int:
    """Convert Mac absolute time to Unix timestamp"""
    if mac_time > 1e12:
        mac_time = mac_time / 1e9
    return int(mac_time + 978307200)


def resolve_path(path: str) -> Optional[str]:
    """Resolve macOS attachment path to full path"""
    if not path:
        return None
    if path.startswith('~'):
        path = os.path.expanduser(path)
    return path if os.path.exists(path) else None


class ImageEmbedder:
    def __init__(self, device: Optional[str] = None):
        """Initialize CLIP model and processor"""
        self.device = device or ("cuda" if torch.cuda.is_available() else 
                                  "mps" if torch.backends.mps.is_available() else "cpu")
        
        print(f"Loading CLIP model on {self.device}...")
        self.model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
        self.processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
        self.model.to(self.device)
        self.model.eval()
        print("CLIP model loaded successfully")
    
    def embed_image(self, image_path: str) -> Optional[np.ndarray]:
        """Generate embedding for a single image"""
        try:
            image = Image.open(image_path).convert("RGB")
            inputs = self.processor(images=image, return_tensors="pt")
            inputs = {k: v.to(self.device) for k, v in inputs.items()}
            
            with torch.no_grad():
                image_features = self.model.get_image_features(**inputs)
                # Normalize the embedding
                image_features = image_features / image_features.norm(dim=-1, keepdim=True)
            
            return image_features.cpu().numpy().flatten()
        except Exception as e:
            print(f"Error embedding {image_path}: {e}")
            return None
    
    def embed_text(self, text: str) -> Optional[np.ndarray]:
        """Generate embedding for text (for text-to-image search)"""
        try:
            inputs = self.processor(text=[text], return_tensors="pt", padding=True)
            inputs = {k: v.to(self.device) for k, v in inputs.items()}
            
            with torch.no_grad():
                text_features = self.model.get_text_features(**inputs)
                text_features = text_features / text_features.norm(dim=-1, keepdim=True)
            
            return text_features.cpu().numpy().flatten()
        except Exception as e:
            print(f"Error embedding text: {e}")
            return None
    
    def embed_batch(self, image_paths: list[str]) -> list[Optional[np.ndarray]]:
        """Generate embeddings for a batch of images"""
        results = []
        images = []
        valid_indices = []
        
        for i, path in enumerate(image_paths):
            try:
                image = Image.open(path).convert("RGB")
                images.append(image)
                valid_indices.append(i)
            except Exception as e:
                print(f"Error loading {path}: {e}")
        
        if not images:
            return [None] * len(image_paths)
        
        try:
            inputs = self.processor(images=images, return_tensors="pt", padding=True)
            inputs = {k: v.to(self.device) for k, v in inputs.items()}
            
            with torch.no_grad():
                image_features = self.model.get_image_features(**inputs)
                image_features = image_features / image_features.norm(dim=-1, keepdim=True)
            
            embeddings = image_features.cpu().numpy()
            
            # Map back to original indices
            result = [None] * len(image_paths)
            for idx, embedding in zip(valid_indices, embeddings):
                result[idx] = embedding.flatten()
            
            return result
        except Exception as e:
            print(f"Error in batch embedding: {e}")
            return [None] * len(image_paths)


def get_image_attachments(db_path: str, since_rowid: int = 0, limit: Optional[int] = None) -> list[dict]:
    """Read image attachments from Messages database"""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    query = """
        SELECT 
            a.ROWID as rowid,
            a.guid,
            a.filename,
            a.mime_type,
            a.created_date,
            a.transfer_name,
            a.total_bytes,
            maj.message_id as message_rowid,
            c.chat_identifier
        FROM attachment a
        LEFT JOIN message_attachment_join maj ON a.ROWID = maj.attachment_id
        LEFT JOIN message m ON maj.message_id = m.ROWID
        LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        LEFT JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE a.filename IS NOT NULL
          AND a.ROWID > ?
          AND (
            a.mime_type LIKE 'image/%'
            OR a.filename LIKE '%.jpg'
            OR a.filename LIKE '%.jpeg'
            OR a.filename LIKE '%.png'
            OR a.filename LIKE '%.gif'
            OR a.filename LIKE '%.heic'
            OR a.filename LIKE '%.heif'
            OR a.filename LIKE '%.webp'
            OR a.filename LIKE '%.tiff'
            OR a.filename LIKE '%.bmp'
          )
        ORDER BY a.ROWID ASC
    """
    
    if limit:
        query += f" LIMIT {limit}"
    
    cursor.execute(query, (since_rowid,))
    
    attachments = []
    for row in cursor.fetchall():
        path = resolve_path(row['filename'])
        if path:
            attachments.append({
                'rowid': row['rowid'],
                'guid': row['guid'],
                'filename': path,
                'mime_type': row['mime_type'] or 'image/jpeg',
                'message_rowid': row['message_rowid'],
                'chat_identifier': row['chat_identifier'],
                'created_at': mac_to_unix(row['created_date']) if row['created_date'] else 0,
                'transfer_name': row['transfer_name'],
                'total_bytes': row['total_bytes'] or 0,
            })
    
    conn.close()
    return attachments


def update_elasticsearch_with_embeddings(es: Elasticsearch, attachments: list[dict], embeddings: list[Optional[np.ndarray]]):
    """Update Elasticsearch documents with image embeddings"""
    operations = []
    
    for attachment, embedding in zip(attachments, embeddings):
        if embedding is None:
            continue
        
        # We need to find the document by message_rowid or create a new image document
        # For now, we'll create/update image-specific documents
        doc_id = f"img_{attachment['guid']}"
        
        doc = {
            "doc": {
                "has_image": True,
                "image_embedding": embedding.tolist(),
            },
            "doc_as_upsert": True
        }
        
        operations.append({"update": {"_index": INDEX_NAME, "_id": doc_id}})
        operations.append(doc)
    
    if operations:
        try:
            es.bulk(operations=operations, refresh=True)
        except Exception as e:
            print(f"Error updating Elasticsearch: {e}")


def create_image_documents(es: Elasticsearch, attachments: list[dict], embeddings: list[Optional[np.ndarray]]):
    """Create new Elasticsearch documents for images with their embeddings"""
    operations = []
    
    for attachment, embedding in zip(attachments, embeddings):
        if embedding is None:
            continue
        
        doc_id = f"img_{attachment['guid']}"
        timestamp = datetime.fromtimestamp(attachment['created_at'])
        
        doc = {
            "text": f"[Image: {attachment['transfer_name'] or 'attachment'}]",
            "image_embedding": embedding.tolist(),
            "sender": "Unknown",  # Will be enriched later
            "sender_is_me": False,
            "participants": [],
            "participant_count": 0,
            "chat_id": attachment['chat_identifier'] or "unknown",
            "chat_name": None,
            "is_dm": True,
            "is_group_chat": False,
            "timestamp": timestamp.isoformat(),
            "year": timestamp.year,
            "month": timestamp.month,
            "day_of_week": timestamp.strftime("%A").lower(),
            "hour_of_day": timestamp.hour,
            "has_attachment": True,
            "has_image": True,
            "chunk_id": doc_id,
            "message_count": 1,
            "start_timestamp": timestamp.isoformat(),
            "end_timestamp": timestamp.isoformat(),
        }
        
        operations.append({"index": {"_index": INDEX_NAME, "_id": doc_id}})
        operations.append(doc)
    
    if operations:
        try:
            result = es.bulk(operations=operations, refresh=True)
            if result.get('errors'):
                print(f"Some documents had errors during indexing")
        except Exception as e:
            print(f"Error indexing to Elasticsearch: {e}")


def main():
    parser = argparse.ArgumentParser(description="Generate CLIP embeddings for iMessage images")
    parser.add_argument("--full", action="store_true", help="Full reindex (ignore previous state)")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE, help="Batch size for embedding")
    parser.add_argument("--es-url", default=DEFAULT_ES_URL, help="Elasticsearch URL")
    parser.add_argument("--limit", type=int, help="Maximum number of images to process")
    parser.add_argument("--dry-run", action="store_true", help="Don't actually update Elasticsearch")
    args = parser.parse_args()
    
    # Check if Messages database exists
    if not os.path.exists(MESSAGES_DB):
        print(f"Error: Messages database not found at {MESSAGES_DB}")
        sys.exit(1)
    
    # Connect to Elasticsearch
    if not args.dry_run:
        es = Elasticsearch(args.es_url)
        if not es.ping():
            print(f"Error: Cannot connect to Elasticsearch at {args.es_url}")
            print("Run: pnpm es:start")
            sys.exit(1)
        print(f"Connected to Elasticsearch at {args.es_url}")
    else:
        es = None
        print("Dry run mode - not updating Elasticsearch")
    
    # Load state
    state = load_state()
    since_rowid = 0 if args.full else state["last_attachment_rowid"]
    
    print(f"\n{'='*50}")
    print("iMessage Image Embedding Pipeline")
    print(f"{'='*50}")
    print(f"Starting from attachment rowid: {since_rowid}")
    
    # Get attachments
    print("\nReading image attachments from Messages database...")
    attachments = get_image_attachments(MESSAGES_DB, since_rowid, args.limit)
    
    if not attachments:
        print("No new images to embed")
        return
    
    print(f"Found {len(attachments)} images to embed")
    
    # Initialize embedder
    embedder = ImageEmbedder()
    
    # Process in batches
    total_embedded = 0
    max_rowid = since_rowid
    
    for i in tqdm(range(0, len(attachments), args.batch_size), desc="Embedding batches"):
        batch = attachments[i:i + args.batch_size]
        image_paths = [a['filename'] for a in batch]
        
        embeddings = embedder.embed_batch(image_paths)
        
        # Count successful embeddings
        successful = sum(1 for e in embeddings if e is not None)
        total_embedded += successful
        
        # Update max rowid
        max_rowid = max(max_rowid, max(a['rowid'] for a in batch))
        
        # Store in Elasticsearch
        if not args.dry_run and es:
            create_image_documents(es, batch, embeddings)
    
    # Update state
    new_state = {
        "last_attachment_rowid": max_rowid,
        "total_images_embedded": state["total_images_embedded"] + total_embedded,
        "last_run": datetime.now().isoformat(),
    }
    save_state(new_state)
    
    print(f"\n{'='*50}")
    print("Embedding Complete!")
    print(f"{'='*50}")
    print(f"Images processed: {len(attachments)}")
    print(f"Successfully embedded: {total_embedded}")
    print(f"Last attachment rowid: {max_rowid}")
    print(f"Total images embedded (all time): {new_state['total_images_embedded']}")


if __name__ == "__main__":
    main()

