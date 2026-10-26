from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    project_name: str = "Task Planner API"
    environment: Literal["development", "production", "test"] = "development"
    database_url: str
    cors_origins: list[str] = []


settings = Settings()  # type: ignore[call-arg]  # values come from the environment
