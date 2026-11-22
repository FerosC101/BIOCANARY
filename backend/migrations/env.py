from alembic import context

from app import models  # noqa: F401
from app.db import Base, engine


def render_item(type_, obj, autogen_context):
    if type_ == "type" and obj.__class__.__name__ == "UtcDateTime":
        return "sa.DateTime(timezone=True)"
    return False


def run() -> None:
    with engine.connect() as connection:
        context.configure(
            connection=connection, target_metadata=Base.metadata, render_item=render_item, render_as_batch=connection.dialect.name == "sqlite"
        )
        with context.begin_transaction():
            context.run_migrations()


run()
