"""FastAPI 应用入口"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import document, query
from app.services import vector_store, storage


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动时初始化连接"""
    print("=" * 50)
    print("Jhj 知识智能体系统启动中...")
    print("=" * 50)

    # 初始化 Milvus 集合（不存在则创建）
    try:
        vector_store.get_collection()
        print("✓ Milvus 集合已就绪")
    except Exception as e:
        print(f"⚠ Milvus 连接失败: {e}")
        print("  请确保 docker compose up 已启动 Milvus 服务")

    # 初始化 MinIO 存储桶
    try:
        storage.ensure_bucket()
        print("✓ MinIO 存储桶已就绪")
    except Exception as e:
        print(f"⚠ MinIO 连接失败: {e}")
        print("  请确保 docker compose up 已启动 MinIO 服务")

    print("=" * 50)
    print("系统启动完成！")
    print("API 文档: http://localhost:8000/docs")
    print("=" * 50)

    yield

    print("\n系统关闭中...")


app = FastAPI(
    title="Jhj 知识智能体系统",
    description="最小可用 RAG 系统：文档入库 → 向量检索 → 智能问答",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(document.router)
app.include_router(query.router)


@app.get("/")
async def root():
    """根路径：系统状态"""
    return {
        "name": "Jhj 知识智能体系统",
        "version": "0.1.0",
        "status": "running",
        "docs": "/docs",
        "endpoints": {
            "上传文档": "POST /api/documents/upload",
            "删除文档": "DELETE /api/documents/{doc_id}",
            "仅检索": "POST /api/query/search",
            "RAG 问答": "POST /api/query/ask",
        },
    }


@app.get("/health")
async def health():
    """健康检查"""
    return {"status": "ok"}
