"""检索与问答接口"""

import re
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import embedding, vector_store, llm
from app.config import settings

router = APIRouter(prefix="/api/query", tags=["检索问答"])

# 中文停用词表（轻量级，用于查询扩展时过滤无意义词）
_STOP_WORDS = {"的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这", "那", "这个", "那个", "怎么", "什么", "为什么", "如何", "哪些", "吗", "呢", "吧", "啊", "呀", "哦", "嗯"}


def _lightweight_query_expansion(question: str) -> list[str]:
    """
    轻量级查询扩展（不依赖 LLM，LLM 失败时的 fallback）

    策略：
    1. 原始查询
    2. 去掉停用词后的关键词组合
    3. 提取英文关键词单独作为查询

    Args:
        question: 用户原始问题

    Returns:
        查询列表
    """
    queries = [question]

    # 去掉停用词，提取关键词
    words = re.findall(r"[\u4e00-\u9fa5]+|[a-zA-Z0-9]+", question)
    keywords = [w for w in words if w not in _STOP_WORDS and len(w) > 1]
    if keywords:
        keyword_query = " ".join(keywords)
        if keyword_query != question:
            queries.append(keyword_query)

    # 提取英文关键词单独查询
    english_words = [w for w in words if re.match(r"^[a-zA-Z0-9]+$", w) and len(w) > 1]
    if english_words:
        queries.append(" ".join(english_words))

    return list(dict.fromkeys(queries))  # 去重保序


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

    流程：
    1. Query 改写：把用户问题扩展成多个检索关键词（同义词、英文翻译）
    2. 批量向量化
    3. 多关键词检索，合并去重后按分数排序

    返回最相关的文本块列表
    """
    try:
        # 1. Query 改写：优先用 LLM 扩展同义词和英文翻译，失败时用轻量级规则扩展
        try:
            queries = await llm.rewrite_query(request.question)
        except Exception:
            queries = _lightweight_query_expansion(request.question)

        # 2. 批量向量化
        query_vectors = await embedding.get_embeddings(queries)

        # 3. 多关键词检索，合并去重，带标题匹配加权
        top_k = request.top_k or settings.RETRIEVAL_TOP_K
        results = vector_store.search_multi_queries(
            query_vectors, top_k=top_k, original_query=request.question
        )

        # 4. 格式化返回
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
    1. Query 改写：把用户问题扩展成多个检索关键词（同义词、英文翻译）
    2. 批量向量化
    3. 多关键词检索，合并去重后按分数排序
    4. 片段拼到 Prompt 里
    5. LLM 基于上下文回答
    """
    try:
        # 1. Query 改写：优先用 LLM 扩展同义词和英文翻译，失败时用轻量级规则扩展
        try:
            queries = await llm.rewrite_query(request.question)
        except Exception:
            queries = _lightweight_query_expansion(request.question)

        # 2. 批量向量化
        query_vectors = await embedding.get_embeddings(queries)

        # 3. 多关键词检索，合并去重，带标题匹配加权
        top_k = request.top_k or settings.RETRIEVAL_TOP_K
        results = vector_store.search_multi_queries(
            query_vectors, top_k=top_k, original_query=request.question
        )

        if not results:
            return QueryResponse(
                question=request.question,
                answer="知识库中没有找到相关信息，请尝试换个问法，或者先上传相关文档。",
                sources=[],
            )

        # 4. 提取文本片段
        contexts = [r["text"] for r in results]

        # 5. LLM 基于上下文回答
        answer = await llm.answer_with_context(request.question, contexts)

        # 6. 格式化返回
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
