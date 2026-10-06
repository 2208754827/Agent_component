"""文档解析服务：用 PyMuPDF 提取 PDF 文本，支持标题层级识别"""

import fitz  # PyMuPDF
from io import BytesIO


def extract_text_from_pdf(file_content: bytes) -> str:
    """
    从 PDF 字节内容中提取纯文本

    Args:
        file_content: PDF 文件的字节内容

    Returns:
        提取的纯文本，按页用换行分隔
    """
    doc = fitz.open(stream=BytesIO(file_content), filetype="pdf")
    pages_text = []

    for page_num, page in enumerate(doc):
        text = page.get_text("text")
        if text.strip():
            pages_text.append(f"--- 第 {page_num + 1} 页 ---\n{text.strip()}")

    doc.close()
    return "\n\n".join(pages_text)


def extract_structured_text_from_pdf(file_content: bytes) -> str:
    """
    从 PDF 中提取带标题层级标记的结构化文本

    通过字体大小识别标题层级：
    - 最大字体 → # 一级标题
    - 次大字体 → ## 二级标题
    - 第三大 → ### 三级标题
    - 其他 → 正文

    这样分块时可以按标题层级切，保证每个块语义完整

    Args:
        file_content: PDF 文件的字节内容

    Returns:
        带 Markdown 标题标记的结构化文本
    """
    doc = fitz.open(stream=BytesIO(file_content), filetype="pdf")

    # 第一步：收集所有字体大小，确定标题层级阈值
    font_sizes = []
    for page in doc:
        blocks = page.get_text("dict")["blocks"]
        for block in blocks:
            if "lines" not in block:
                continue
            for line in block["lines"]:
                for span in line["spans"]:
                    size = round(span["size"], 1)
                    if size > 0:
                        font_sizes.append(size)

    # 统计字体大小出现频率，取前 3 大作为标题层级
    from collections import Counter
    size_counter = Counter(font_sizes)
    # 按字体大小降序，取出现次数较多的前几个
    sorted_sizes = sorted(size_counter.items(), key=lambda x: x[0], reverse=True)
    # 标题字体：比正文字体大的，取前 3 级
    heading_sizes = set()
    for size, count in sorted_sizes[:10]:
        if count >= 2:  # 至少出现 2 次才算标题样式
            heading_sizes.add(size)
        if len(heading_sizes) >= 3:
            break

    # 按大小排序，映射到标题层级
    heading_levels = sorted(heading_sizes, reverse=True)

    def get_heading_level(font_size: float) -> int:
        """根据字体大小返回标题层级，1-3 级，0 表示正文"""
        for i, size in enumerate(heading_levels):
            if abs(font_size - size) < 0.5:
                return i + 1
        return 0

    # 第二步：逐页提取文本，给标题加标记
    pages_text = []
    for page_num, page in enumerate(doc):
        blocks = page.get_text("dict")["blocks"]
        page_lines = []

        for block in blocks:
            if "lines" not in block:
                continue
            for line in block["lines"]:
                # 取这一行最大的字体大小作为行的字体
                line_size = max(span["size"] for span in line["spans"]) if line["spans"] else 0
                line_text = "".join(span["text"] for span in line["spans"]).strip()

                if not line_text:
                    continue

                level = get_heading_level(line_size)
                if level == 1:
                    page_lines.append(f"\n# {line_text}\n")
                elif level == 2:
                    page_lines.append(f"\n## {line_text}\n")
                elif level == 3:
                    page_lines.append(f"\n### {line_text}\n")
                else:
                    page_lines.append(line_text)

        if page_lines:
            pages_text.append(f"--- 第 {page_num + 1} 页 ---\n" + "\n".join(page_lines))

    doc.close()
    return "\n\n".join(pages_text)


def extract_text_from_file(file_content: bytes, filename: str) -> str:
    """
    根据文件类型提取文本（带标题层级标记）

    Args:
        file_content: 文件字节内容
        filename: 文件名（用于判断类型）

    Returns:
        提取的结构化文本（PDF 带标题标记，其他格式原样返回）
    """
    filename_lower = filename.lower()

    if filename_lower.endswith(".pdf"):
        # PDF 用结构化提取，带标题层级标记
        return extract_structured_text_from_pdf(file_content)
    elif filename_lower.endswith(".txt") or filename_lower.endswith(".md"):
        return file_content.decode("utf-8", errors="ignore")
    else:
        # 其他格式暂时按文本处理，后续再扩展
        try:
            return file_content.decode("utf-8", errors="ignore")
        except Exception:
            return ""
