"""
Browse indexed chunks
"""

import os
import streamlit as st
from datetime import datetime
from qdrant_client import QdrantClient
from qdrant_client.models import ScrollRequest
from dotenv import load_dotenv

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', '.env'))

QDRANT_URL = os.getenv('QDRANT_URL', 'http://localhost:6333')
COLLECTION_NAME = 'imessage_chunks'

st.set_page_config(
    page_title="Browse Chunks",
    page_icon="📚",
    layout="wide",
)

st.title("📚 Browse Indexed Chunks")
st.caption("View all indexed message chunks")

@st.cache_resource
def get_qdrant():
    return QdrantClient(url=QDRANT_URL)

try:
    qdrant = get_qdrant()
    collection_info = qdrant.get_collection(COLLECTION_NAME)
    total_points = collection_info.points_count
except Exception as e:
    st.error(f"Cannot connect to Qdrant: {e}")
    st.stop()

# Sidebar controls
with st.sidebar:
    st.header("📊 Stats")
    st.metric("Total Chunks", total_points)
    
    st.divider()
    
    st.header("🔧 Options")
    page_size = st.slider("Chunks per page", 10, 100, 25)
    
    sort_order = st.radio(
        "Sort by",
        ["Newest first", "Oldest first"],
        index=0
    )
    
    # Filter options
    st.divider()
    st.header("🔍 Filter")
    filter_person = st.text_input("By person", placeholder="e.g., John")
    filter_group = st.text_input("By group chat", placeholder="e.g., Family")
    only_groups = st.checkbox("Only group chats")

# Pagination state
if 'offset' not in st.session_state:
    st.session_state.offset = None
if 'page' not in st.session_state:
    st.session_state.page = 0

# Build filter
filter_conditions = []
if filter_person:
    filter_conditions.append({
        "key": "participants",
        "match": {"value": filter_person}
    })
if filter_group:
    filter_conditions.append({
        "key": "group_name",
        "match": {"value": filter_group}
    })
if only_groups:
    filter_conditions.append({
        "key": "is_group_chat",
        "match": {"value": True}
    })

scroll_filter = {"must": filter_conditions} if filter_conditions else None

# Navigation
col1, col2, col3 = st.columns([1, 2, 1])
with col1:
    if st.button("⬅️ Previous", disabled=st.session_state.page == 0):
        st.session_state.page = max(0, st.session_state.page - 1)
        st.session_state.offset = None  # Reset to recalculate
        st.rerun()

with col2:
    st.markdown(f"<center>Page {st.session_state.page + 1}</center>", unsafe_allow_html=True)

with col3:
    if st.button("Next ➡️"):
        st.session_state.page += 1
        st.rerun()

st.divider()

# Fetch chunks using scroll
try:
    # For simplicity, we'll use scroll without offset tracking for now
    # In production, you'd want proper cursor-based pagination
    
    results, next_offset = qdrant.scroll(
        collection_name=COLLECTION_NAME,
        limit=page_size,
        offset=st.session_state.offset,
        scroll_filter=scroll_filter,
        with_payload=True,
        with_vectors=False,
    )
    
    st.session_state.offset = next_offset
    
    if not results:
        st.info("No chunks found. Try adjusting filters or index more messages.")
    else:
        # Sort by timestamp
        sorted_results = sorted(
            results,
            key=lambda x: x.payload.get('start_ts', 0),
            reverse=(sort_order == "Newest first")
        )
        
        for i, point in enumerate(sorted_results):
            payload = point.payload
            
            # Header info
            if payload.get('group_name'):
                chat_name = f"👥 {payload['group_name']}"
            else:
                participants = [p for p in payload.get('participants', []) if p != 'Me']
                chat_name = f"💬 {', '.join(participants)}" if participants else "💬 Unknown"
            
            # Timestamp
            start_ts = payload.get('start_ts', 0)
            end_ts = payload.get('end_ts', 0)
            try:
                start_str = datetime.fromtimestamp(start_ts).strftime('%b %d, %Y %I:%M %p')
                end_str = datetime.fromtimestamp(end_ts).strftime('%I:%M %p')
                time_str = f"{start_str} - {end_str}"
            except:
                time_str = "Unknown time"
            
            # Calculate time ago
            try:
                delta = datetime.now() - datetime.fromtimestamp(start_ts)
                if delta.days > 365:
                    ago = f"{delta.days // 365}y ago"
                elif delta.days > 30:
                    ago = f"{delta.days // 30}mo ago"
                elif delta.days > 0:
                    ago = f"{delta.days}d ago"
                else:
                    ago = "today"
            except:
                ago = ""
            
            # Display chunk
            with st.expander(f"{chat_name} • {ago} • {payload.get('message_count', '?')} msgs", expanded=False):
                st.caption(f"🕐 {time_str}")
                st.caption(f"👤 Participants: {', '.join(payload.get('participants', []))}")
                st.caption(f"🆔 ID: `{point.id}`")
                
                st.divider()
                
                # Format messages with colors
                text = payload.get('text', '')
                lines = text.split('\n')
                
                for line in lines:
                    if line.startswith('[Me '):
                        st.markdown(f"🟢 `{line}`")
                    elif line.startswith('['):
                        st.markdown(f"🔵 `{line}`")
                    elif line.strip():
                        st.text(line)

except Exception as e:
    st.error(f"Error fetching chunks: {e}")

# Footer
st.divider()
st.caption(f"Showing up to {page_size} chunks per page • Total indexed: {total_points}")

