"""分块服务：语义分块，按标题层级切分 + 段落聚合 + 重叠"""

import re
from app.config import settings


def split_by_paragraph(text: str) -> list[str]:
    """按段落分割文本"""
    # 按双换行分割段落
    paragraphs = re.split(r"\n\s*\n", text)
    # 去除空段落和首尾空白
    return [p.strip() for p in paragraphs if p.strip()]


def split_by_heading(text: str) -> list[tuple[str, str]]:
    """
    按标题层级切分文本

    识别 # 一级标题 和 ## 二级标题 作为分块边界
    返回 [(heading, content), ...] 列表

    Args:
        text: 带 Markdown 标题标记的文本

    Returns:
        (标题, 内容) 元组列表，标题为空表示标题前的正文
    """
    # 匹配 # 或 ## 开头的标题行（不匹配 ### 及更深层级，避免切太碎）
    pattern = r"^(#{1,2})\s+(.+)$"

    lines = text.split("\n")
    sections = []
    current_heading = ""
    current_content = []

    for line in lines:
        match = re.match(pattern, line.strip())
        if match:
            # 遇到新标题，保存当前段
            if current_heading or current_content:
                content = "\n".join(current_content).strip()
                if content:
                    sections.append((current_heading, content))
            current_heading = match.group(2).strip()
            current_content = []
        else:
            current_content.append(line)

    # 保存最后一段
    if current_heading or current_content:
        content = "\n".join(current_content).strip()
        if content:
            sections.append((current_heading, content))

    return sections


def _merge_paragraphs_with_overlap(
    paragraphs: list[str],
    chunk_size: int,
    chunk_overlap: int,
) -> list[str]:
    """
    段落聚合成块，带重叠

    策略：
    1. 段落聚合到 chunk_size 左右
    2. 在段落边界切分，避免切断句子
    3. 相邻块保留 overlap 的重叠
    4. 单个超长段落用固定长度兜底

    Args:
        paragraphs: 段落列表
        chunk_size: 每块最大字符数
        chunk_overlap: 重叠字符数

    Returns:
        文本块列表
    """
    if not paragraphs:
        return []

    chunks = []
    current_chunk = []
    current_length = 0

    for para in paragraphs:
        para_length = len(para)

        # 单个段落超长，用固定长度兜底
        if para_length > chunk_size:
            # 先保存当前块
            if current_chunk:
                chunks.append("\n\n".join(current_chunk))
                current_chunk = []
                current_length = 0
            # 固定长度切这个超长段落
            for i in range(0, para_length, chunk_size - chunk_overlap):
                piece = para[i:i + chunk_size]
                if len(piece) >= 50:  # 太短的尾部丢弃
                    chunks.append(piece)
            continue

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


def chunk_text(text: str, chunk_size: int = None, chunk_overlap: int = None) -> list[str]:
    """
    语义分块：按标题层级切分 + 段落聚合 + 重叠

    策略：
    1. 先按 # 一级标题 和 ## 二级标题 切大段（保证每个块语义完整，不切断章节）
    2. 每个大段内按段落聚合到 chunk_size
    3. 在段落边界切分，避免切断句子
    4. 单个超长段落用固定长度兜底
    5. 相邻块保留 overlap 的重叠

    Args:
        text: 输入文本（PDF 解析后带标题标记，其他格式纯文本也能用）
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

    # 第一步：按标题层级切大段
    sections = split_by_heading(text)

    # 如果没有识别到标题，退化为纯段落聚合
    if not sections or all(not h for h, _ in sections):
        paragraphs = split_by_paragraph(text)
        return _merge_paragraphs_with_overlap(paragraphs, chunk_size, chunk_overlap)

    # 第二步：每个大段内按段落聚合成块
    all_chunks = []
    for heading, content in sections:
        paragraphs = split_by_paragraph(content)
        # 把标题加到每个块的开头，增强语义
        if heading:
            paragraphs = [f"【{heading}】\n{p}" if i == 0 else p for i, p in enumerate(paragraphs)]
        chunks = _merge_paragraphs_with_overlap(paragraphs, chunk_size, chunk_overlap)
        all_chunks.extend(chunks)

    return all_chunks
