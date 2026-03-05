import logging
import os
from datetime import datetime

import anthropic
from sqlalchemy.orm import Session

from database import Commitment, Conversation, Goal, Memory, UserProfile
from memory_extractor import extract_and_save, clean_response
from calendar_integration import get_todays_events

logger = logging.getLogger(__name__)

AGENT_NAME = os.getenv("AGENT_NAME", "Max")
MODEL = "claude-sonnet-4-20250514"

client = anthropic.Anthropic()


def _get_user_profile(db: Session) -> str:
    profiles = db.query(UserProfile).all()
    if not profiles:
        return "Noch keine Profil-Informationen gespeichert."
    return "\n".join(f"- {p.key}: {p.value}" for p in profiles)


def _get_active_goals(db: Session) -> str:
    goals = db.query(Goal).filter(Goal.status == "active").all()
    if not goals:
        return "Keine aktiven Ziele."
    lines = []
    for g in goals:
        deadline = f" (Deadline: {g.deadline})" if g.deadline else ""
        lines.append(f"- {g.title}{deadline}: {g.description}")
        if g.progress_notes:
            lines.append(f"  Notizen: {g.progress_notes}")
    return "\n".join(lines)


def _get_open_commitments(db: Session) -> str:
    commitments = db.query(Commitment).filter(Commitment.status == "open").all()
    if not commitments:
        return "Keine offenen Commitments."
    lines = []
    for c in commitments:
        due = f" (bis {c.due_date})" if c.due_date else ""
        lines.append(f"- {c.text}{due}")
    return "\n".join(lines)


def _get_relevant_memories(db: Session, user_message: str) -> str:
    words = set(user_message.lower().split())
    # Remove very short words
    words = {w for w in words if len(w) > 2}
    if not words:
        return "Keine relevanten Erinnerungen."

    all_memories = db.query(Memory).all()
    scored = []
    for m in all_memories:
        key_words = set(m.key.lower().split())
        value_words = set(m.value.lower().split())
        overlap = len(words & (key_words | value_words))
        if overlap > 0:
            scored.append((overlap, m))

    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:10]

    if not top:
        return "Keine relevanten Erinnerungen."

    # Update last_referenced
    now = datetime.utcnow()
    for _, m in top:
        m.last_referenced = now
    db.commit()

    return "\n".join(f"- [{m.category}] {m.key}: {m.value}" for _, m in top)


def _get_conversation_history(db: Session, limit: int = 20) -> list[dict]:
    convos = (
        db.query(Conversation)
        .order_by(Conversation.timestamp.desc())
        .limit(limit)
        .all()
    )
    convos.reverse()
    return [{"role": c.role, "content": c.content} for c in convos]


def _build_system_prompt(db: Session, user_message: str) -> str:
    profile = _get_user_profile(db)
    goals = _get_active_goals(db)
    commitments = _get_open_commitments(db)
    memories = _get_relevant_memories(db, user_message)
    calendar = get_todays_events()
    now = datetime.now().strftime("%A, %d. %B %Y, %H:%M Uhr")

    if isinstance(calendar, list) and calendar:
        cal_text = "\n".join(
            f"- {e['summary']} ({e['start']} - {e['end']})" for e in calendar
        )
    else:
        cal_text = "Keine Termine heute." if not calendar else str(calendar)

    return f"""Du bist ein persoenlicher KI-Agent namens {AGENT_NAME}. Du kennst mich gut und arbeitest proaktiv fuer mich. Hier ist dein aktueller Kontext ueber mich:

**Profil:**
{profile}

**Aktive Ziele:**
{goals}

**Offene Commitments:**
{commitments}

**Relevante Erinnerungen:**
{memories}

**Heutige Kalender-Events:**
{cal_text}

**Aktuelle Zeit:** {now}

Verhalte dich wie ein vertrauensvoller persoenlicher Assistent: direkt, warm, ohne unnoetige Floskeln. Antworte auf Deutsch.

Wenn du aus dem Gespraech neue Ziele, Commitments oder wichtige Informationen erkennst, weise am Ende deiner Antwort darauf hin mit dem Tag <EXTRACT>...</EXTRACT>.

Das EXTRACT-Format ist JSON:
{{"memories": [{{"key": "...", "value": "...", "category": "..."}}], "goals": [{{"title": "...", "description": "...", "deadline": "YYYY-MM-DD"}}], "commitments": [{{"text": "...", "due_date": "YYYY-MM-DD"}}]}}

Verwende EXTRACT nur wenn es wirklich neue Informationen gibt, nicht bei jedem Gespraech."""


def chat(message: str, db: Session) -> str:
    # Save user message
    db.add(Conversation(role="user", content=message))
    db.commit()

    # Build context
    system_prompt = _build_system_prompt(db, message)
    history = _get_conversation_history(db, limit=20)

    # Remove the last message (the one we just added) to avoid duplication
    if history and history[-1]["role"] == "user" and history[-1]["content"] == message:
        messages = history
    else:
        messages = history + [{"role": "user", "content": message}]

    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=4096,
            system=system_prompt,
            messages=messages,
            tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 3}],
        )

        # Extract text from response
        response_text = ""
        for block in response.content:
            if block.type == "text":
                response_text += block.text

    except Exception as e:
        logger.error(f"Claude API error: {e}")
        response_text = f"Entschuldigung, es gab einen Fehler bei der Verarbeitung: {str(e)}"

    # Extract memories/goals/commitments
    extract_and_save(response_text, db)
    cleaned = clean_response(response_text)

    # Save assistant response
    db.add(Conversation(role="assistant", content=cleaned))
    db.commit()

    return cleaned


def proactive_check(context: str, db: Session) -> tuple[bool, str]:
    """Ask Claude whether to proactively contact the user.

    Returns (should_notify, message).
    """
    goals = _get_active_goals(db)
    commitments = _get_open_commitments(db)
    calendar = get_todays_events()
    now = datetime.now().strftime("%A, %d. %B %Y, %H:%M Uhr")

    if isinstance(calendar, list) and calendar:
        cal_text = "\n".join(
            f"- {e['summary']} ({e['start']} - {e['end']})" for e in calendar
        )
    else:
        cal_text = "Keine Termine heute."

    prompt = f"""Du bist {AGENT_NAME}, ein proaktiver persoenlicher Assistent.
Es ist jetzt {now}. Kontext: {context}

**Aktive Ziele:**
{goals}

**Offene Commitments:**
{commitments}

**Heutige Events:**
{cal_text}

Soll ich den Nutzer jetzt kontaktieren? Beruecksichtige:
- Gibt es dringende Deadlines?
- Gibt es Ziele ohne Fortschritt?
- Ist es eine sinnvolle Tageszeit fuer eine Erinnerung?
- Gibt es bevorstehende Events?

Antworte GENAU in diesem Format:
ENTSCHEIDUNG: JA oder NEIN
NACHRICHT: [Deine Nachricht an den Nutzer, falls JA. Sonst leer.]"""

    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}],
        )

        text = ""
        for block in response.content:
            if block.type == "text":
                text += block.text

        should_notify = "ENTSCHEIDUNG: JA" in text.upper()
        message = ""
        if should_notify and "NACHRICHT:" in text:
            message = text.split("NACHRICHT:", 1)[1].strip()

        return should_notify, message

    except Exception as e:
        logger.error(f"Proactive check error: {e}")
        return False, ""
