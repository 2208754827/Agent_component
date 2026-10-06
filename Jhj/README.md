# Jhj 知识智能体系统

最小可用的 RAG 系统：文档入库 → 向量检索 → 智能问答。

## 功能

- 📄 **文档上传**：支持 PDF/TXT/MD，自动提取文本
- ✂️ **智能分块**：按段落聚合，固定大小 + 重叠
- 🔢 **向量化**：OpenAI 兼容 Embedding 接口
- 🔍 **向量检索**：Milvus + HNSW 索引，余弦相似度
- 💬 **RAG 问答**：检索相关片段 + LLM 基于上下文回答

## 技术栈

| 组件 | 技术 |
|---|---|
| 后端框架 | FastAPI + Python 3.11 |
| 向量数据库 | Milvus 2.4 |
| 对象存储 | MinIO |
| 关系数据库 | PostgreSQL 16（预留） |
| 缓存 | Redis 7（预留） |
| 文档解析 | PyMuPDF |
| LLM | OpenAI 兼容接口 |

## 快速开始

### 1. 启动基础设施

```bash
cd Jhj
docker compose up -d
```

等待所有服务健康检查通过（约 30 秒）。

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，填入你的 LLM API Key 和 Embedding API Key。

### 3. 安装 Python 依赖

```bash
pip install -r requirements.txt
```

### 4. 启动应用

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

打开 http://localhost:8000/docs 查看 API 文档。

## API 接口

### 上传文档

```bash
curl -X POST http://localhost:8000/api/documents/upload \
  -F "file=@your_document.pdf"
```

返回：
```json
{
  "doc_id": "uuid",
  "filename": "your_document.pdf",
  "chunk_count": 10,
  "message": "文档入库成功，共 10 个文本块"
}
```

### 仅检索（不生成回答）

```bash
curl -X POST http://localhost:8000/api/query/search \
  -H "Content-Type: application/json" \
  -d '{"question": "你的问题", "top_k": 5}'
```

### RAG 问答

```bash
curl -X POST http://localhost:8000/api/query/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "你的问题", "top_k": 5}'
```

返回：
```json
{
  "question": "你的问题",
  "answer": "基于文档的回答...",
  "sources": [
    {
      "doc_id": "uuid",
      "chunk_index": 0,
      "text": "相关文本片段...",
      "score": 0.85
    }
  ]
}
```

## 项目结构

```
Jhj/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI 入口
│   ├── config.py            # 配置管理
│   ├── routers/
│   │   ├── document.py      # 文档上传接口
│   │   └── query.py         # 检索问答接口
│   └── services/
│       ├── parser.py        # 文档解析（PyMuPDF）
│       ├── chunker.py       # 文本分块
│       ├── embedding.py     # 向量化
│       ├── vector_store.py  # Milvus 操作
│       ├── storage.py       # MinIO 操作
│       └── llm.py           # LLM 调用
├── data/                    # Docker 数据挂载目录
├── docker-compose.yml       # 基础设施编排
├── .env.example             # 环境变量示例
├── requirements.txt         # Python 依赖
└── README.md
```

## 处理流程

### 文档入库

```
上传文件 → MinIO 存储 → PyMuPDF 提取文本 → 按段落分块
→ 批量向量化 → 写入 Milvus（HNSW 索引）
```

### RAG 问答

```
用户提问 → 问题向量化 → Milvus 检索 Top-K 相关片段
→ 片段拼入 Prompt → LLM 基于上下文生成回答 → 返回答案 + 来源
```

## 后续规划

- [ ] 换 MinerU 做高质量解析（公式/表格/双栏）
- [ ] 语义分块（按标题层级 + 语义边界）
- [ ] Query 改写（LLM 扩展同义词/英文翻译）
- [ ] 多路召回（稠密 + 稀疏）+ RRF 融合
- [ ] Rerank 精排（BGE-Reranker）
- [ ] RAG 评估体系（多层指标）
- [ ] LangGraph Agent 编排
- [ ] 知识图谱（Neo4j）
- [ ] 沙箱执行（Harness）
- [ ] 子智能体协作
