"""
iMessage Search Dashboard
Run with: streamlit run dashboard/app.py
"""

import os
import streamlit as st
from datetime import datetime, timedelta
from qdrant_client import QdrantClient
from openai import OpenAI
from dotenv import load_dotenv

# Load environment variables from parent directory
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

# Configuration
QDRANT_URL = os.getenv('QDRANT_URL', 'http://localhost:6333')
COLLECTION_NAME = 'imessage_chunks'
EMBEDDING_MODEL = 'text-embedding-3-small'

# Initialize clients
@st.cache_resource
def get_clients():
    qdrant = QdrantClient(url=QDRANT_URL)
    openai = OpenAI()
    return qdrant, openai

# Page config
st.set_page_config(
    page_title="iMessage Search",
    page_icon="💬",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Add page navigation hint
st.sidebar.success("👆 Use sidebar to switch pages")

# Custom CSS
st.markdown("""
<style>
    .message-card {
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border-radius: 12px;
        padding: 20px;
        margin-bottom: 16px;
        border-left: 4px solid #4ade80;
    }
    .message-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 12px;
        color: #94a3b8;
        font-size: 0.85em;
    }
    .message-text {
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
        line-height: 1.6;
        white-space: pre-wrap;
    }
    .score-badge {
        background: #4ade80;
        color: #000;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 0.75em;
        font-weight: 600;
    }
    .stTextInput > div > div > input {
        font-size: 1.1em;
    }
</style>
""", unsafe_allow_html=True)

# Header
st.title("💬 iMessage Search")
st.caption("Semantic search across your message history")

# Sidebar filters
with st.sidebar:
    st.header("🔧 Filters")
    
    # Get unique participants from Qdrant
    try:
        qdrant, openai_client = get_clients()
        
        # Get collection info
        collection_info = qdrant.get_collection(COLLECTION_NAME)
        st.metric("Indexed Chunks", collection_info.points_count)
        
    except Exception as e:
        st.error(f"Cannot connect to Qdrant: {e}")
        st.info("Make sure Qdrant is running: `pnpm qdrant:start`")
        st.stop()
    
    st.divider()
    
    # Filters
    person_filter = st.text_input("👤 Filter by person", placeholder="e.g., John Smith")
    
    date_range = st.date_input(
        "📅 Date range",
        value=(datetime.now() - timedelta(days=365), datetime.now()),
        format="YYYY-MM-DD"
    )
    
    result_count = st.slider("📊 Max results", 5, 50, 10)
    
    st.divider()
    st.caption("Built with Streamlit + Qdrant")

# Main search
query = st.text_input(
    "🔍 Search your messages",
    placeholder="e.g., 'dinner plans', 'what did we talk about last week'",
    key="search_query"
)

if query:
    with st.spinner("Searching..."):
        try:
            # Generate embedding for query
            embedding_response = openai_client.embeddings.create(
                model=EMBEDDING_MODEL,
                input=query,
                dimensions=1536
            )
            query_vector = embedding_response.data[0].embedding
            
            # Build filters
            filter_conditions = []
            
            if person_filter:
                filter_conditions.append({
                    "key": "participants",
                    "match": {"value": person_filter}
                })
            
            if date_range and len(date_range) == 2:
                start_ts = int(datetime.combine(date_range[0], datetime.min.time()).timestamp())
                end_ts = int(datetime.combine(date_range[1], datetime.max.time()).timestamp())
                filter_conditions.append({
                    "key": "start_ts",
                    "range": {"gte": start_ts}
                })
                filter_conditions.append({
                    "key": "end_ts",
                    "range": {"lte": end_ts}
                })
            
            search_filter = {"must": filter_conditions} if filter_conditions else None
            
            # Search Qdrant
            search_result = qdrant.query_points(
                collection_name=COLLECTION_NAME,
                query=query_vector,
                limit=result_count,
                query_filter=search_filter,
                with_payload=True
            )
            results = search_result.points
            
            if not results:
                st.info("No results found. Try a different query or adjust filters.")
            else:
                st.success(f"Found {len(results)} results")
                
                for i, result in enumerate(results):
                    payload = result.payload
                    
                    # Format header
                    if payload.get('group_name'):
                        chat_name = payload['group_name']
                    else:
                        participants = [p for p in payload.get('participants', []) if p != 'Me']
                        chat_name = ', '.join(participants) if participants else 'Unknown'
                    
                    # Format timestamp
                    start_ts = payload.get('start_ts', 0)
                    try:
                        date_str = datetime.fromtimestamp(start_ts).strftime('%b %d, %Y at %I:%M %p')
                    except:
                        date_str = 'Unknown date'
                    
                    # Calculate relative time
                    try:
                        delta = datetime.now() - datetime.fromtimestamp(start_ts)
                        if delta.days > 365:
                            relative = f"{delta.days // 365} years ago"
                        elif delta.days > 30:
                            relative = f"{delta.days // 30} months ago"
                        elif delta.days > 0:
                            relative = f"{delta.days} days ago"
                        elif delta.seconds > 3600:
                            relative = f"{delta.seconds // 3600} hours ago"
                        else:
                            relative = "recently"
                    except:
                        relative = ""
                    
                    # Display card
                    with st.container():
                        col1, col2 = st.columns([4, 1])
                        with col1:
                            st.markdown(f"**{chat_name}**")
                            st.caption(f"📅 {date_str} ({relative})")
                        with col2:
                            st.metric("Score", f"{result.score:.2f}")
                        
                        # Message content in an expander or directly
                        message_text = payload.get('text', '')
                        
                        # Color code the messages
                        lines = message_text.split('\n')
                        formatted_lines = []
                        for line in lines:
                            if line.startswith('[Me '):
                                formatted_lines.append(f"🟢 {line}")
                            elif line.startswith('['):
                                formatted_lines.append(f"🔵 {line}")
                            else:
                                formatted_lines.append(line)
                        
                        st.code('\n'.join(formatted_lines), language=None)
                        st.divider()
                        
        except Exception as e:
            st.error(f"Search failed: {e}")
            if "OPENAI_API_KEY" in str(e):
                st.info("Make sure OPENAI_API_KEY is set in your .env file")

else:
    # Show some stats when no query
    st.info("👆 Enter a search query above to find messages")
    
    # Quick search suggestions
    st.subheader("💡 Try searching for:")
    cols = st.columns(4)
    suggestions = ["dinner plans", "weekend", "thank you", "funny"]
    for col, suggestion in zip(cols, suggestions):
        if col.button(suggestion, use_container_width=True):
            st.session_state.search_query = suggestion
            st.rerun()

