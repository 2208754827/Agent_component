from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """全局配置，从环境变量读取"""

    # LLM
    LLM_BASE_URL: str = "https://hapi.hc11.org/v1"
    LLM_API_KEY: str = ""
    LLM_MODEL: str = "deepseek-v4.1-flash"

    # Embedding
    EMBEDDING_BASE_URL: str = "https://hapi.hc11.org/v1"
    EMBEDDING_API_KEY: str = ""
    EMBEDDING_MODEL: str = "text-embedding-3-small"
    EMBEDDING_DIM: int = 1536

    # Milvus
    MILVUS_HOST: str = "localhost"
    MILVUS_PORT: int = 19530
    MILVUS_COLLECTION: str = "jhj_documents"

    # MinIO
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin"
    MINIO_BUCKET: str = "jhj-documents"

    # 分块
    CHUNK_SIZE: int = 512
    CHUNK_OVERLAP: int = 64

    # 检索
    RETRIEVAL_TOP_K: int = 5

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
