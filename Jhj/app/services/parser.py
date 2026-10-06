"""文档解析服务：用 PyMuPDF 提取 PDF 文本"""

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


def extract_text_from_file(file_content: bytes, filename: str) -> str:
    """
    根据文件类型提取文本

    Args:
        file_content: 文件字节内容
        filename: 文件名（用于判断类型）

    Returns:
        提取的纯文本
    """
    filename_lower = filename.lower()

    if filename_lower.endswith(".pdf"):
        return extract_text_from_pdf(file_content)
    elif filename_lower.endswith(".txt") or filename_lower.endswith(".md"):
        return file_content.decode("utf-8", errors="ignore")
    else:
        # 其他格式暂时按文本处理，后续再扩展
        try:
            return file_content.decode("utf-8", errors="ignore")
        except Exception:
            return ""
