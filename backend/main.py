"""Gift app API.

Run from this folder:  ../.venv/bin/python -m uvicorn main:app --port 8020
"""

from __future__ import annotations

import json
import re

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import calendar_import
import demo
import link_reader
import metrics
import finder
import notes_parser
import store
import usage
from llm import MODEL_NAME
from models import (
    CardMessage, CardRequest, FinderRequest, IdeaStatusUpdate, Metric, NewPerson, PersonUpdate, PhotoUpload, ImportantDate, ImportRequest, ParsedPerson, ImportResult, NewIdea, ParseResponse, ParseTextRequest,
    Person,
)
from safety import BlockedBySafetyFilter
from usage import SpendingCapReached

MAX_IMAGE_BYTES = 8 * 1024 * 1024
IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
SAFETY_MESSAGE = (
    "The AI provider's safety filter blocked this note, usually because it contains text aimed at an AI "
    "(like \"ignore previous instructions\"). Remove that part and try again."
)

app = FastAPI(title="Gift app API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5190", "http://127.0.0.1:5190"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "model": MODEL_NAME}


@app.get("/api/usage")
def usage_status() -> dict:
    """Today's AI spend vs the daily cap (shown in the app footer)."""
    return usage.status()


@app.post("/api/notes/parse", response_model=ParseResponse)
async def parse_notes(body: ParseTextRequest) -> ParseResponse:
    try:
        parsed, cached, used = await notes_parser.parse_text(body.text, store.load_people())
    except SpendingCapReached as e:
        raise HTTPException(429, str(e)) from e
    except BlockedBySafetyFilter as e:
        raise HTTPException(422, SAFETY_MESSAGE) from e
    except Exception as e:  # model/network errors -> readable message for the UI
        raise HTTPException(502, f"The notes parser couldn't finish: {e}") from e
    return ParseResponse(parsed=parsed, cached=cached, model=MODEL_NAME, usage=used)


@app.post("/api/notes/parse-image", response_model=ParseResponse)
async def parse_notes_image(file: UploadFile = File(...)) -> ParseResponse:
    if file.content_type not in IMAGE_TYPES:
        raise HTTPException(415, "Upload a PNG, JPG, WEBP or GIF screenshot.")
    data = await file.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "That image is over 8 MB. Try a smaller screenshot.")
    try:
        parsed, cached, used = await notes_parser.parse_image(data, file.content_type, store.load_people())
    except SpendingCapReached as e:
        raise HTTPException(429, str(e)) from e
    except BlockedBySafetyFilter as e:
        raise HTTPException(422, SAFETY_MESSAGE) from e
    except Exception as e:
        raise HTTPException(502, f"The notes parser couldn't read that image: {e}") from e
    return ParseResponse(parsed=parsed, cached=cached, model=MODEL_NAME, usage=used)


@app.get("/api/people", response_model=list[Person])
def list_people() -> list[Person]:
    return store.load_people()


@app.post("/api/people", response_model=Person)
def create_person(body: NewPerson) -> Person:
    return store.create_person(body)


@app.post("/api/people/{person_id}/photo", response_model=Person)
def set_photo(person_id: str, body: PhotoUpload) -> Person:
    """Profile photo, resized in the browser first. Only small JPEG/PNG/WEBP data URLs are accepted."""
    if body.data_url and not re.fullmatch(r"data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+", body.data_url):
        raise HTTPException(415, "Upload a JPG, PNG or WEBP image.")
    person = store.set_photo(person_id, body.data_url)
    if person is None:
        raise HTTPException(404, "No person with that id.")
    return person


@app.put("/api/people/{person_id}", response_model=Person)
def update_person(person_id: str, body: PersonUpdate) -> Person:
    person = store.update_person(person_id, body)
    if person is None:
        raise HTTPException(404, "No person with that id.")
    return person


@app.post("/api/metrics")
def record_metric(body: Metric) -> dict:
    metrics.record(body)
    return {"ok": True}


@app.get("/api/metrics")
def metrics_summary() -> dict:
    """Median time per task, from this app's own timings (for the impact section)."""
    return metrics.summary()


@app.post("/api/people/import", response_model=ImportResult)
def import_people(body: ImportRequest) -> ImportResult:
    return store.import_people(body.people)


@app.delete("/api/people/{person_id}")
def delete_person(person_id: str) -> dict:
    if not store.delete_person(person_id):
        raise HTTPException(404, "No person with that id.")
    return {"deleted": person_id}


@app.post("/api/calendar/parse", response_model=list[ParsedPerson])
async def parse_calendar(file: UploadFile = File(...)) -> list[ParsedPerson]:
    """Birthdays/anniversaries from a .ics calendar or .vcf contacts export (no AI call)."""
    name = (file.filename or "").lower()
    if not name.endswith((".ics", ".vcf")):
        raise HTTPException(415, "Upload a calendar export (.ics) or a contacts export (.vcf).")
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(413, "That file is over 5 MB.")
    return calendar_import.parse_file(name, data.decode("utf-8", errors="replace"), store.load_people())


@app.post("/api/people/{person_id}/dates", response_model=Person)
def set_date(person_id: str, body: ImportantDate) -> Person:
    person = store.set_date(person_id, body)
    if person is None:
        raise HTTPException(404, "No person with that id.")
    return person


class LinkRequest(BaseModel):
    url: str = Field(max_length=2000)


@app.post("/api/links/read", response_model=link_reader.LinkDraft)
async def read_link(body: LinkRequest) -> link_reader.LinkDraft:
    """Pasted product link -> draft idea (not saved until the user confirms)."""
    try:
        return await link_reader.read_link(body.url)
    except link_reader.UnsafeLink as e:
        raise HTTPException(400, str(e)) from e
    except SpendingCapReached as e:
        raise HTTPException(429, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"Couldn't read that link: {e}") from e


@app.post("/api/demo/load", response_model=list[Person])
def load_demo() -> list[Person]:
    """Add sample people with dates relative to today (no AI call)."""
    return demo.load_demo()


@app.post("/api/people/{person_id}/ideas/{idea_id}/status", response_model=Person)
def set_idea_status(person_id: str, idea_id: str, body: IdeaStatusUpdate) -> Person:
    person = store.set_idea_status(person_id, idea_id, body.status, body.year, body.spent)
    if person is None:
        raise HTTPException(404, "No such person or idea.")
    return person


@app.post("/api/people/{person_id}/ideas", response_model=Person)
def add_idea(person_id: str, body: NewIdea) -> Person:
    person = store.add_idea(person_id, body)
    if person is None:
        raise HTTPException(404, "No person with that id.")
    return person


# ---------------------------------------------------------------- gift finder


@app.post("/api/finder/run")
async def run_finder(body: FinderRequest) -> StreamingResponse:
    """Streams newline-delimited JSON: agent progress events, then the result."""
    person = store.get_person(body.person_id)
    if person is None:
        raise HTTPException(404, "No person with that id.")
    body.location = (body.location or "").strip() or None
    store.set_location(person.id, body.location)  # remember it for next time
    person.location = body.location

    async def stream():
        try:
            async for event in finder.run_finder(body, person):
                yield json.dumps(event) + "\n"
        except SpendingCapReached as e:
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"
        except BlockedBySafetyFilter:
            yield json.dumps({"type": "error", "message": SAFETY_MESSAGE}) + "\n"
        except Exception as e:
            yield json.dumps({"type": "error", "message": f"The gift team couldn't finish: {e}"}) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")


@app.post("/api/finder/card", response_model=CardMessage)
async def write_card(body: CardRequest) -> CardMessage:
    person = store.get_person(body.person_id)
    if person is None:
        raise HTTPException(404, "No person with that id.")
    try:
        return await finder.write_card(body, person)
    except SpendingCapReached as e:
        raise HTTPException(429, str(e)) from e
    except BlockedBySafetyFilter as e:
        raise HTTPException(422, SAFETY_MESSAGE) from e
    except Exception as e:
        raise HTTPException(502, f"The message writer couldn't finish: {e}") from e
