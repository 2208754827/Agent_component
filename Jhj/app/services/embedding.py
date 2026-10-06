"""向量化服务：调用 OpenAI 兼容接口生成 Embedding"""

import httpx
from app.config import settings


async def get_embeddings(texts: list[str]) -> list[list[float]]:
    """
    批量生成文本的向量表示

    Args:
        texts: 文本列表

    Returns:
        向量列表，每个向量是 float 列表
    """
    if not texts:
        return []

    url = f"{settings.EMBEDDING_BASE_URL}/embeddings"
    headers = {
        "Authorization": f"Bearer {settings.EMBEDDING_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.EMBEDDING_MODEL,
        "input": texts,
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()

    # 按 index 排序，确保顺序正确
    embeddings = sorted(data["data"], key=lambda x: x["index"])
    return [item["embedding"] for item in embeddings]


async def get_embedding(text: str) -> list[float]:
    """
    生成单条文本的向量表示

    Args:
        text: 输入文本

    Returns:
        向量
    """
    result = await get_embeddings([text])
    return result[0] if result else []
