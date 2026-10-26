"""Birthday reminders by email or text.

Two ways, so the app still runs with only the course key:
1. Always on: ready-to-send reminder messages. The page builds mailto: and
   sms: links that open your own Mail or Messages app with the text filled in
   (handy for texting a learning team). Nothing is sent by the app itself.
2. Optional automatic email: if SMTP settings are in .env (GIFT_SMTP_HOST,
   GIFT_SMTP_PORT, GIFT_SMTP_USER, GIFT_SMTP_PASSWORD, GIFT_SMTP_FROM) and you
   turn it on, the backend checks once an hour and emails one digest a day
   when something is coming up. No AI involved, so it costs nothing.
"""

from __future__ import annotations

import asyncio
import json
import os
import smtplib
import ssl
from datetime import date, timedelta
from email.message import EmailMessage
from pathlib import Path

import certifi
from pydantic import BaseModel, Field

import store

FILE = Path(__file__).resolve().parent.parent / "data" / "reminders.json"
WINDOW_DAYS = 14  # what counts as "coming up"


class ReminderSettings(BaseModel):
    email: str | None = Field(None, max_length=200)
    phone: str | None = Field(None, max_length=40)
    auto_email: bool = False
    last_sent: str | None = None


def load_settings() -> ReminderSettings:
    try:
        return ReminderSettings.model_validate_json(FILE.read_text())
    except (FileNotFoundError, ValueError):
        return ReminderSettings()


def save_settings(s: ReminderSettings) -> ReminderSettings:
    FILE.parent.mkdir(parents=True, exist_ok=True)
    FILE.write_text(s.model_dump_json(indent=1))
    return s


def smtp_configured() -> bool:
    return bool(os.getenv("GIFT_SMTP_HOST") and os.getenv("GIFT_SMTP_FROM"))


def _fmt(d: date) -> str:
    return d.strftime("%a, %b %-d")


def upcoming(within: int = WINDOW_DAYS, today: date | None = None) -> list[dict]:
    today = today or date.today()
    rows = []
    for p in store.load_people():
        for d in p.dates:
            if not d.month:
                continue
            when = date(today.year, d.month, d.day or 1)
            if when < today:
                when = date(today.year + 1, d.month, d.day or 1)
            days = (when - today).days
            if days > within:
                continue
            order_by = when - timedelta(days=3)
            ideas = [i.title for i in p.ideas if i.status == "idea"][:3]
            what = "Christmas" if d.occasion == "christmas" else f"{p.name}'s {d.occasion}"
            if days == 0:
                line = f"Today is {what}! Same-day gifts only."
            elif days < 3:
                line = f"{what} is {_fmt(when)} (in {days} day{'s' if days != 1 else ''}). Same-day gifts only now."
            else:
                line = f"{what} is {_fmt(when)} (in {days} days). Order by {_fmt(order_by)} for 2–3 day shipping."
            if ideas:
                line += f" Saved ideas: {', '.join(ideas)}."
            rows.append({"person_id": p.id, "person": p.name, "occasion": d.occasion, "date": when.isoformat(),
                         "days_left": days, "order_by": order_by.isoformat(), "text": line})
    return sorted(rows, key=lambda r: r["days_left"])


def digest_text(rows: list[dict]) -> str:
    if not rows:
        return "Nothing coming up in the next two weeks."
    return "🎁 Coming up:\n" + "\n".join(f"• {r['text']}" for r in rows) + "\n\nFind a gift: http://localhost:5190"


def send_email(to: str, subject: str, body: str) -> None:
    """Send one email through the SMTP server in .env (STARTTLS on 587, SSL on 465)."""
    host, port = os.environ["GIFT_SMTP_HOST"], int(os.getenv("GIFT_SMTP_PORT", "587"))
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = os.environ["GIFT_SMTP_FROM"], to, subject
    msg.set_content(body)
    ctx = ssl.create_default_context(cafile=certifi.where())
    if port == 465:
        server = smtplib.SMTP_SSL(host, port, context=ctx, timeout=15)
    else:
        server = smtplib.SMTP(host, port, timeout=15)
        if os.getenv("GIFT_SMTP_STARTTLS", "true").lower() != "false":
            server.starttls(context=ctx)
    with server:
        if os.getenv("GIFT_SMTP_USER"):
            server.login(os.environ["GIFT_SMTP_USER"], os.environ.get("GIFT_SMTP_PASSWORD", ""))
        server.send_message(msg)


def send_digest_if_due(today: date | None = None) -> str:
    """Email today's digest once, if turned on, configured, and something is coming up."""
    today = today or date.today()
    s = load_settings()
    if not (s.auto_email and s.email and smtp_configured()):
        return "off"
    if s.last_sent == today.isoformat():
        return "already sent today"
    rows = upcoming(today=today)
    if not rows:
        return "nothing coming up"
    send_email(s.email, f"Giftwise: {len(rows)} occasion{'s' if len(rows) != 1 else ''} coming up", digest_text(rows))
    s.last_sent = today.isoformat()
    save_settings(s)
    return "sent"


async def scheduler() -> None:
    """Background loop started with the backend: check once an hour."""
    while True:
        try:
            await asyncio.to_thread(send_digest_if_due)
        except Exception as e:  # noqa: BLE001  (a mail hiccup must never take the app down)
            print(f"[reminders] email failed: {e}")
        await asyncio.sleep(3600)
