"""Runtime configuration. Every value can be set through a BIOCANARY_* environment variable or .env."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEV_SECRET = "development-only-secret-change-before-deploying"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="BIOCANARY_", env_file=BACKEND_DIR / ".env", extra="ignore", protected_namespaces=()
    )

    # local  : developer machine, local adapters permitted, demo data permitted
    # production : refuses to start with development secrets
    environment: Literal["local", "production"] = "local"

    # --- Application -----------------------------------------------------------------
    secret_key: str = DEV_SECRET
    session_hours: int = 12
    cookie_secure: bool = False
    cors_origins: str = ""
    login_attempts_per_15_min: int = 10
    run_background_worker: bool = True

    # --- Demonstration data ----------------------------------------------------------
    demo_enabled: bool = True
    demo_user: str = "operator@biocanary.demo"
    demo_password: str = "listen-today"
    demo_history_days: int = 30

    # --- Storage adapters ------------------------------------------------------------
    # Any SQLAlchemy URL. Huawei Cloud RDS for PostgreSQL: postgresql+psycopg://user:pw@host:5432/db?sslmode=require
    database_url: str = f"sqlite:///{BACKEND_DIR / 'var' / 'biocanary.db'}"
    database_provider: Literal["local", "huawei_rds"] = "local"

    cache_provider: Literal["memory", "redis", "huawei_dcs"] = "memory"
    redis_url: str = ""

    object_provider: Literal["filesystem", "huawei_obs"] = "filesystem"
    object_dir: str = str(BACKEND_DIR / "var" / "objects")
    obs_endpoint: str = ""  # e.g. https://obs.ap-southeast-1.myhuaweicloud.com
    obs_bucket: str = ""
    obs_access_key: str = ""
    obs_secret_key: str = ""

    inference_provider: Literal["local", "modelarts"] = "local"
    modelarts_endpoint: str = ""  # real-time service invocation URL
    modelarts_auth: Literal["appcode", "iam", "none"] = "appcode"
    modelarts_app_code: str = ""
    modelarts_timeout_seconds: float = 8.0
    iam_endpoint: str = ""  # e.g. https://iam.ap-southeast-1.myhuaweicloud.com
    iam_domain: str = ""
    iam_username: str = ""
    iam_password: str = ""
    iam_project: str = ""

    compute_provider: Literal["local", "huawei_ecs"] = "local"

    # --- Model -----------------------------------------------------------------------
    model_path: str = str(BACKEND_DIR.parent / "ml" / "artifacts" / "inhibition_classifier.json")

    # --- Ingestion -------------------------------------------------------------------
    max_future_skew_seconds: int = 300
    max_backfill_days: int = 45
    max_batch_readings: int = 500
    offline_after_minutes: int = 30

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    def assert_safe(self) -> None:
        """Refuse to run a production deployment on development credentials."""
        if self.environment != "production":
            return
        problems = []
        if self.secret_key == DEV_SECRET or len(self.secret_key) < 32:
            problems.append("BIOCANARY_SECRET_KEY must be a unique value of at least 32 characters")
        if self.demo_enabled and self.demo_password == "listen-today":
            problems.append("set BIOCANARY_DEMO_ENABLED=false or change BIOCANARY_DEMO_PASSWORD")
        if problems:
            raise RuntimeError("Unsafe production configuration: " + "; ".join(problems))


@lru_cache
def get_settings() -> Settings:
    return Settings()
