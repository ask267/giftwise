"""One place that builds the model every agent uses (OpenAI through Portkey)."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from openai import AsyncOpenAI
from pydantic_ai.models.openai import OpenAIResponsesModel
from pydantic_ai.providers.openai import OpenAIProvider

HERE = Path(__file__).resolve().parent
for _env in (HERE / ".env", HERE.parent / ".env", HERE.parents[1] / ".env"):
    load_dotenv(_env, override=False)

MODEL_NAME = os.getenv("GIFT_MODEL", "gpt-6-luna")  # course key allows gpt-6-luna only
PORTKEY_BASE_URL = os.getenv("PORTKEY_BASE_URL", "https://api.portkey.ai/v1")


def build_model() -> OpenAIResponsesModel:
    api_key = os.getenv("PORTKEY_API_KEY")
    if not api_key:
        raise RuntimeError("PORTKEY_API_KEY not found. Put it in .env in this repo folder or the folder above it (see .env.example).")
    client = AsyncOpenAI(base_url=PORTKEY_BASE_URL, api_key=api_key)
    return OpenAIResponsesModel(MODEL_NAME, provider=OpenAIProvider(openai_client=client))
