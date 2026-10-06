"""检索与问答接口"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import embedding, vector_store, llm
from app.config import settings

router = APIRouter(prefix="/api/query", tags=["检索问答"])


class QueryRequest(BaseModel):
    question: str
    top_k: int = None  # 不传则用默认配置


class SearchResult(BaseModel):
    doc_id: str
    chunk_index: int
    text: str
    score: float


class QueryResponse(BaseModel):
    question: str
    answer: str
    sources: list[SearchResult]


@router.post("/search", response_model=list[SearchResult])
async def search_only(request: QueryRequest):
    """
    仅检索，不生成回答

    返回最相关的文本块列表
    """
    try:
        # 1. 问题向量化
        query_vector = await embedding.get_embedding(request.question)

        # 2. 向量检索
        top_k = request.top_k or settings.RETRIEVAL_TOP_K
        results = vector_store.search_vectors(query_vector, top_k=top_k)

        # 3. 格式化返回
        return [
            SearchResult(
                doc_id=r["doc_id"],
                chunk_index=r["chunk_index"],
                text=r["text"],
                score=r["score"],
            )
            for r in results
        ]

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"检索失败: {str(e)}")


@router.post("/ask", response_model=QueryResponse)
async def ask_with_rag(request: QueryRequest):
    """
    RAG 问答：检索 + 生成

    流程：
    1. 问题向量化
    2. Milvus 检索相关片段
    3. 片段拼到 Prompt 里
    4. LLM 基于上下文回答
    """
    try:
        # 1. 问题向量化
        query_vector = await embedding.get_embedding(request.question)

        # 2. 向量检索
        top_k = request.top_k or settings.RETRIEVAL_TOP_K
        results = vector_store.search_vectors(query_vector, top_k=top_k)

        if not results:
            return QueryResponse(
                question=request.question,
                answer="知识库中没有找到相关信息，请尝试换个问法，或者先上传相关文档。",
                sources=[],
            )

        # 3. 提取文本片段
        contexts = [r["text"] for r in results]

        # 4. LLM 基于上下文回答
        answer = await llm.answer_with_context(request.question, contexts)

        # 5. 格式化返回
        sources = [
            SearchResult(
                doc_id=r["doc_id"],
                chunk_index=r["chunk_index"],
                text=r["text"],
                score=r["score"],
            )
            for r in results
        ]

        return QueryResponse(
            question=request.question,
            answer=answer,
            sources=sources,
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"问答失败: {str(e)}")
