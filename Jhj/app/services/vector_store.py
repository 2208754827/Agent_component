"""向量存储服务：Milvus 集合的创建、插入、检索"""

from pymilvus import (
    connections,
    Collection,
    CollectionSchema,
    FieldSchema,
    DataType,
    utility,
)
from app.config import settings


# 全局连接状态
_connected = False


def ensure_connection():
    """确保 Milvus 连接已建立"""
    global _connected
    if not _connected:
        connections.connect(
            alias="default",
            host=settings.MILVUS_HOST,
            port=settings.MILVUS_PORT,
        )
        _connected = True


def get_collection() -> Collection:
    """
    获取或创建 Milvus 集合

    集合结构：
    - id: 主键（自增）
    - doc_id: 文档 ID
    - chunk_index: 块在文档中的序号
    - text: 文本内容
    - vector: 向量
    """
    ensure_connection()

    collection_name = settings.MILVUS_COLLECTION

    if utility.has_collection(collection_name):
        collection = Collection(collection_name)
        collection.load()
        return collection

    # 定义字段
    fields = [
        FieldSchema(name="id", dtype=DataType.INT64, is_primary=True, auto_id=True),
        FieldSchema(name="doc_id", dtype=DataType.VARCHAR, max_length=128),
        FieldSchema(name="chunk_index", dtype=DataType.INT32),
        FieldSchema(name="text", dtype=DataType.VARCHAR, max_length=65535),
        FieldSchema(name="vector", dtype=DataType.FLOAT_VECTOR, dim=settings.EMBEDDING_DIM),
    ]

    schema = CollectionSchema(fields, description="Jhj 文档向量集合")
    collection = Collection(collection_name, schema)

    # 创建 HNSW 索引
    index_params = {
        "metric_type": "COSINE",
        "index_type": "HNSW",
        "params": {"M": 32, "efConstruction": 400},
    }
    collection.create_index(field_name="vector", index_params=index_params)
    collection.load()

    return collection


def insert_vectors(doc_id: str, chunks: list[str], vectors: list[list[float]]):
    """
    批量插入文档块和向量

    Args:
        doc_id: 文档 ID
        chunks: 文本块列表
        vectors: 向量列表，与 chunks 一一对应
    """
    collection = get_collection()

    data = [
        [doc_id] * len(chunks),           # doc_id
        list(range(len(chunks))),          # chunk_index
        chunks,                             # text
        vectors,                            # vector
    ]

    collection.insert(data)
    collection.flush()


def search_vectors(query_vector: list[float], top_k: int = None) -> list[dict]:
    """
    向量相似度检索

    Args:
        query_vector: 查询向量
        top_k: 返回结果数，默认从配置读取

    Returns:
        检索结果列表，每个结果包含：
        - id: 主键
        - doc_id: 文档 ID
        - chunk_index: 块序号
        - text: 文本内容
        - score: 相似度分数
    """
    if top_k is None:
        top_k = settings.RETRIEVAL_TOP_K

    collection = get_collection()

    search_params = {
        "metric_type": "COSINE",
        "params": {"ef": 128},
    }

    results = collection.search(
        data=[query_vector],
        anns_field="vector",
        param=search_params,
        limit=top_k,
        output_fields=["doc_id", "chunk_index", "text"],
    )

    output = []
    for hits in results:
        for hit in hits:
            output.append({
                "id": hit.id,
                "doc_id": hit.entity.get("doc_id"),
                "chunk_index": hit.entity.get("chunk_index"),
                "text": hit.entity.get("text"),
                "score": hit.score,
            })

    return output


def delete_by_doc_id(doc_id: str):
    """
    删除指定文档的所有向量

    Args:
        doc_id: 文档 ID
    """
    collection = get_collection()
    collection.delete(expr=f'doc_id == "{doc_id}"')
    collection.flush()


def search_multi_queries(
    query_vectors: list[list[float]],
    top_k: int = None,
    per_query_k: int = None,
) -> list[dict]:
    """
    多关键词检索：多个查询向量分别检索，合并去重后按分数排序

    用于 Query 改写后的多路召回，解决用户用词和文档对不上的问题

    Args:
        query_vectors: 多个查询向量列表
        top_k: 最终返回结果数，默认从配置读取
        per_query_k: 每个查询向量检索多少条，默认 top_k * 2

    Returns:
        合并去重后的检索结果列表，按相似度分数降序排列
    """
    if top_k is None:
        top_k = settings.RETRIEVAL_TOP_K
    if per_query_k is None:
        per_query_k = top_k * 2  # 每个查询多捞一些，合并后取 top_k

    # 每个查询向量分别检索
    all_results = []
    for query_vector in query_vectors:
        results = search_vectors(query_vector, top_k=per_query_k)
        all_results.extend(results)

    # 按 doc_id + chunk_index 去重，保留最高分
    seen = {}
    for r in all_results:
        key = f"{r['doc_id']}_{r['chunk_index']}"
        if key not in seen or r["score"] > seen[key]["score"]:
            seen[key] = r

    # 按分数降序排序，取 top_k
    merged = sorted(seen.values(), key=lambda x: x["score"], reverse=True)
    return merged[:top_k]
