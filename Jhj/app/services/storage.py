"""对象存储服务：MinIO 文件上传下载"""

from minio import Minio
from minio.error import S3Error
from io import BytesIO
from app.config import settings


_client: Minio = None


def get_client() -> Minio:
    """获取 MinIO 客户端（单例）"""
    global _client
    if _client is None:
        _client = Minio(
            settings.MINIO_ENDPOINT,
            access_key=settings.MINIO_ACCESS_KEY,
            secret_key=settings.MINIO_SECRET_KEY,
            secure=False,  # 本地开发用 HTTP
        )
    return _client


def ensure_bucket():
    """确保存储桶存在"""
    client = get_client()
    bucket_name = settings.MINIO_BUCKET
    if not client.bucket_exists(bucket_name):
        client.make_bucket(bucket_name)


def upload_file(file_content: bytes, object_name: str, content_type: str = "application/octet-stream"):
    """
    上传文件到 MinIO

    Args:
        file_content: 文件字节内容
        object_name: 对象名称（路径）
        content_type: MIME 类型
    """
    ensure_bucket()
    client = get_client()
    client.put_object(
        bucket_name=settings.MINIO_BUCKET,
        object_name=object_name,
        data=BytesIO(file_content),
        length=len(file_content),
        content_type=content_type,
    )


def download_file(object_name: str) -> bytes:
    """
    从 MinIO 下载文件

    Args:
        object_name: 对象名称

    Returns:
        文件字节内容
    """
    client = get_client()
    response = client.get_object(
        bucket_name=settings.MINIO_BUCKET,
        object_name=object_name,
    )
    try:
        return response.read()
    finally:
        response.close()
        response.release_conn()
