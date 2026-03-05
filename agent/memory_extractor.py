import json
import logging
import re

from sqlalchemy.orm import Session

from database import Commitment, Goal, Memory

logger = logging.getLogger(__name__)

EXTRACT_PATTERN = re.compile(r"<EXTRACT>(.*?)</EXTRACT>", re.DOTALL)


def extract_and_save(response_text: str, db: Session) -> None:
    """Parse <EXTRACT> tags from Claude response and save to database."""
    matches = EXTRACT_PATTERN.findall(response_text)
    if not matches:
        return

    for match in matches:
        try:
            data = json.loads(match.strip())
        except json.JSONDecodeError:
            logger.warning(f"Failed to parse EXTRACT JSON: {match[:100]}...")
            continue

        # Save memories
        for mem in data.get("memories", []):
            key = mem.get("key", "").strip()
            value = mem.get("value", "").strip()
            if key and value:
                existing = db.query(Memory).filter(Memory.key == key).first()
                if existing:
                    existing.value = value
                    existing.category = mem.get("category", "general")
                else:
                    db.add(Memory(
                        key=key,
                        value=value,
                        category=mem.get("category", "general"),
                    ))
                logger.info(f"Memory saved: {key}")

        # Save goals
        for goal in data.get("goals", []):
            title = goal.get("title", "").strip()
            if title:
                existing = db.query(Goal).filter(Goal.title == title, Goal.status == "active").first()
                if not existing:
                    db.add(Goal(
                        title=title,
                        description=goal.get("description", ""),
                        deadline=goal.get("deadline"),
                    ))
                    logger.info(f"Goal saved: {title}")

        # Save commitments
        for commit in data.get("commitments", []):
            text = commit.get("text", "").strip()
            if text:
                db.add(Commitment(
                    text=text,
                    due_date=commit.get("due_date"),
                ))
                logger.info(f"Commitment saved: {text}")

        db.commit()


def clean_response(text: str) -> str:
    """Remove <EXTRACT> tags from response before showing to user."""
    return EXTRACT_PATTERN.sub("", text).strip()
