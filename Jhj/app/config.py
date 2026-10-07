from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """全局配置，从环境变量读取"""

    # LLM
    LLM_BASE_URL: str = "https://api.inferera.com/v1"
    LLM_API_KEY: str = ""
    LLM_MODEL: str = "agents-a1-free"

    # Embedding
    EMBEDDING_PROVIDER: str = "local"  # local 或 openai
    EMBEDDING_BASE_URL: str = "https://api.inferera.com/v1"
    EMBEDDING_API_KEY: str = ""
    EMBEDDING_MODEL: str = "BAAI/bge-small-zh-v1.5"
    EMBEDDING_DIM: int = 512

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
        extra = "ignore"


settings = Settings()
