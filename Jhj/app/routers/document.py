"""文档上传与入库接口"""

import uuid
from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel

from app.services import parser, chunker, embedding, vector_store, storage

router = APIRouter(prefix="/api/documents", tags=["文档管理"])


class UploadResponse(BaseModel):
    doc_id: str
    filename: str
    chunk_count: int
    message: str


@router.post("/upload", response_model=UploadResponse)
async def upload_document(file: UploadFile = File(...)):
    """
    上传文档并入库

    流程：
    1. 文件存 MinIO
    2. 提取文本
    3. 分块
    4. 向量化
    5. 写入 Milvus
    """
    # 读取文件内容
    file_content = await file.read()
    if not file_content:
        raise HTTPException(status_code=400, detail="文件内容为空")

    # 生成文档 ID
    doc_id = str(uuid.uuid4())
    filename = file.filename or "unknown"

    try:
        # 1. 存 MinIO
        object_name = f"{doc_id}/{filename}"
        storage.upload_file(
            file_content,
            object_name,
            content_type=file.content_type or "application/octet-stream",
        )

        # 2. 提取文本
        text = parser.extract_text_from_file(file_content, filename)
        if not text.strip():
            raise HTTPException(status_code=400, detail="未能从文件中提取到文本内容")

        # 3. 分块
        chunks = chunker.chunk_text(text)
        if not chunks:
            raise HTTPException(status_code=400, detail="文本分块失败")

        # 4. 向量化（批量）
        vectors = await embedding.get_embeddings(chunks)

        # 5. 写入 Milvus
        vector_store.insert_vectors(doc_id, chunks, vectors)

        return UploadResponse(
            doc_id=doc_id,
            filename=filename,
            chunk_count=len(chunks),
            message=f"文档入库成功，共 {len(chunks)} 个文本块",
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"文档入库失败: {str(e)}")


@router.delete("/{doc_id}")
async def delete_document(doc_id: str):
    """删除文档及其向量"""
    try:
        vector_store.delete_by_doc_id(doc_id)
        return {"message": f"文档 {doc_id} 已删除"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"删除失败: {str(e)}")
