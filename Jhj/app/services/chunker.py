"""分块服务：将长文本切分为固定大小的块，带重叠"""

import re
from app.config import settings


def split_by_paragraph(text: str) -> list[str]:
    """按段落分割文本"""
    # 按双换行分割段落
    paragraphs = re.split(r"\n\s*\n", text)
    # 去除空段落和首尾空白
    return [p.strip() for p in paragraphs if p.strip()]


def chunk_text(text: str, chunk_size: int = None, chunk_overlap: int = None) -> list[str]:
    """
    将文本切分为固定大小的块，带重叠

    策略：
    1. 先按段落分割
    2. 段落聚合到 chunk_size 左右
    3. 在段落边界切分，避免切断句子
    4. 相邻块保留 overlap 的重叠

    Args:
        text: 输入文本
        chunk_size: 每块最大字符数，默认从配置读取
        chunk_overlap: 重叠字符数，默认从配置读取

    Returns:
        文本块列表
    """
    if chunk_size is None:
        chunk_size = settings.CHUNK_SIZE
    if chunk_overlap is None:
        chunk_overlap = settings.CHUNK_OVERLAP

    if not text.strip():
        return []

    paragraphs = split_by_paragraph(text)

    if not paragraphs:
        return []

    chunks = []
    current_chunk = []
    current_length = 0

    for para in paragraphs:
        para_length = len(para)

        # 如果当前段落加上后超过 chunk_size，且当前块非空，就先保存当前块
        if current_length + para_length > chunk_size and current_chunk:
            chunk_text = "\n\n".join(current_chunk)
            chunks.append(chunk_text)

            # 处理重叠：保留最后几个段落作为下一块的开头
            overlap_chars = 0
            overlap_paras = []
            for p in reversed(current_chunk):
                if overlap_chars + len(p) <= chunk_overlap:
                    overlap_paras.insert(0, p)
                    overlap_chars += len(p)
                else:
                    break

            current_chunk = overlap_paras
            current_length = overlap_chars

        current_chunk.append(para)
        current_length += para_length

    # 保存最后一块
    if current_chunk:
        chunks.append("\n\n".join(current_chunk))

    return chunks
