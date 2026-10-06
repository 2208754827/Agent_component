"""LLM 服务：调用 OpenAI 兼容接口进行对话生成"""

import httpx
from app.config import settings


async def chat_completion(
    messages: list[dict],
    temperature: float = 0.7,
    max_tokens: int = 4096,
    stream: bool = False,
) -> str:
    """
    调用 LLM 生成回复

    Args:
        messages: 对话消息列表，格式 [{"role": "user"/"system"/"assistant", "content": "..."}]
        temperature: 温度参数
        max_tokens: 最大生成 token 数
        stream: 是否流式输出（当前版本暂不支持流式，返回完整文本）

    Returns:
        生成的文本内容
    """
    url = f"{settings.LLM_BASE_URL}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.LLM_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.LLM_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,  # 先做非流式，简单稳定
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()

    return data["choices"][0]["message"]["content"]


async def answer_with_context(question: str, contexts: list[str]) -> str:
    """
    基于检索到的上下文回答问题

    Args:
        question: 用户问题
        contexts: 检索到的相关文本片段列表

    Returns:
        基于上下文的回答
    """
    # 组装上下文
    context_text = "\n\n".join([f"【片段{i+1}】\n{ctx}" for i, ctx in enumerate(contexts)])

    system_prompt = """你是一个专业的知识问答助手。请根据下面提供的参考资料回答用户的问题。

规则：
1. 只基于参考资料回答，不要编造资料中没有的信息
2. 如果参考资料中没有相关内容，请直接说"参考资料中没有找到相关信息"
3. 回答要简洁准确，引用资料中的内容时可以标注【片段X】
4. 用中文回答"""

    user_prompt = f"""【参考资料】
{context_text}

【用户问题】
{question}"""

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    return await chat_completion(messages, temperature=0.3)


async def rewrite_query(question: str, num_queries: int = 4) -> list[str]:
    """
    Query 改写：把用户问题扩展成多个检索关键词

    解决用户用词和文档对不上的问题，比如用户说"双分支"，文档里写"dual-branch"

    Args:
        question: 用户原始问题
        num_queries: 生成几个检索关键词，默认 4 个

    Returns:
        检索关键词列表，包含原始问题
    """
    system_prompt = """你是一个专业的检索查询改写助手。用户会给你一个问题，你需要把它改写成多个适合用于向量检索的关键词或短语。

规则：
1. 生成的关键词要覆盖用户问题的核心概念
2. 包含同义词、近义词、相关术语
3. 如果是中文问题，同时给出英文翻译（学术文档常用英文）
4. 每个关键词简洁明了，不要太长
5. 直接输出关键词，每行一个，不要编号，不要解释"""

    user_prompt = f"""请把下面这个问题改写成 {num_queries} 个检索关键词：

{question}"""

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    result = await chat_completion(messages, temperature=0.3, max_tokens=512)

    # 解析结果，按行分割，去掉空行
    queries = [line.strip() for line in result.split("\n") if line.strip()]

    # 确保原始问题在列表里
    if question not in queries:
        queries.insert(0, question)

    # 去重，限制数量
    seen = set()
    unique_queries = []
    for q in queries:
        if q not in seen:
            seen.add(q)
            unique_queries.append(q)
        if len(unique_queries) >= num_queries + 1:  # +1 因为包含原始问题
            break

    return unique_queries
