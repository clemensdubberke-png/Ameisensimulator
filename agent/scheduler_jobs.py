import asyncio
import logging
import os
from datetime import datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy.orm import Session, sessionmaker

from database import Commitment, Monitor

logger = logging.getLogger(__name__)

AGENT_NAME = os.getenv("AGENT_NAME", "Max")


def setup_scheduler(scheduler: AsyncIOScheduler, session_factory: sessionmaker):
    """Register all scheduled jobs."""

    scheduler.add_job(
        morning_check,
        CronTrigger(hour=7, minute=30),
        args=[session_factory],
        id="morning_check",
        name="Morgen-Check",
    )

    scheduler.add_job(
        midday_check,
        CronTrigger(hour=12, minute=0),
        args=[session_factory],
        id="midday_check",
        name="Mittags-Check",
    )

    scheduler.add_job(
        evening_check,
        CronTrigger(hour=19, minute=0),
        args=[session_factory],
        id="evening_check",
        name="Abend-Check",
    )

    scheduler.add_job(
        monitor_check,
        CronTrigger(hour=10, minute=0),
        args=[session_factory],
        id="monitor_check",
        name="Monitor-Check",
    )

    logger.info("All scheduler jobs registered")


async def morning_check(session_factory: sessionmaker):
    """Morning check: calendar + proactive contact decision."""
    logger.info("Running morning check")
    try:
        from claude_client import proactive_check
        from ntfy_client import send_notification

        db: Session = session_factory()
        try:
            should_notify, message = proactive_check("Morgen-Check (7:30 Uhr)", db)
            if should_notify and message:
                await send_notification(
                    title=f"{AGENT_NAME} - Guten Morgen",
                    message=message,
                    tags="sunrise",
                )
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Morning check failed: {e}")


async def midday_check(session_factory: sessionmaker):
    """Midday check: commitments and goal progress."""
    logger.info("Running midday check")
    try:
        from claude_client import proactive_check
        from ntfy_client import send_notification

        db: Session = session_factory()
        try:
            should_notify, message = proactive_check("Mittags-Check (12:00 Uhr)", db)
            if should_notify and message:
                await send_notification(
                    title=f"{AGENT_NAME} - Mittags-Update",
                    message=message,
                    tags="clock12",
                )
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Midday check failed: {e}")


async def evening_check(session_factory: sessionmaker):
    """Evening check: overdue commitments and daily review."""
    logger.info("Running evening check")
    try:
        from claude_client import proactive_check
        from ntfy_client import send_notification

        db: Session = session_factory()
        try:
            # Mark overdue commitments
            today = datetime.now().strftime("%Y-%m-%d")
            overdue = (
                db.query(Commitment)
                .filter(
                    Commitment.status == "open",
                    Commitment.due_date.isnot(None),
                    Commitment.due_date < today,
                )
                .all()
            )
            for c in overdue:
                c.status = "overdue"
                c.follow_up_count += 1
                c.last_followup = datetime.utcnow()
            if overdue:
                db.commit()
                logger.info(f"Marked {len(overdue)} commitments as overdue")

            should_notify, message = proactive_check("Abend-Check (19:00 Uhr)", db)
            if should_notify and message:
                await send_notification(
                    title=f"{AGENT_NAME} - Abend-Review",
                    message=message,
                    tags="moon",
                )
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Evening check failed: {e}")


async def monitor_check(session_factory: sessionmaker):
    """Check all active monitors using web search."""
    logger.info("Running monitor check")
    try:
        import anthropic
        from ntfy_client import send_notification

        client = anthropic.Anthropic()
        db: Session = session_factory()
        try:
            monitors = db.query(Monitor).filter(Monitor.active.is_(True)).all()
            if not monitors:
                logger.info("No active monitors")
                return

            for monitor in monitors:
                logger.info(f"Checking monitor: {monitor.topic}")
                try:
                    response = client.messages.create(
                        model="claude-sonnet-4-20250514",
                        max_tokens=1000,
                        messages=[
                            {
                                "role": "user",
                                "content": f"Suche nach aktuellen Neuigkeiten zu: {monitor.query}\n\nFasse die wichtigsten 3-5 Ergebnisse kompakt auf Deutsch zusammen.",
                            }
                        ],
                        tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 5}],
                    )

                    summary = ""
                    for block in response.content:
                        if block.type == "text":
                            summary += block.text

                    if summary:
                        await send_notification(
                            title=f"{AGENT_NAME} - Monitor: {monitor.topic}",
                            message=summary[:500],
                            tags="mag",
                            force=True,  # Monitor notifications bypass rate limiting
                        )

                    monitor.last_checked = datetime.utcnow()
                    db.commit()

                except Exception as e:
                    logger.error(f"Monitor check failed for '{monitor.topic}': {e}")

        finally:
            db.close()
    except Exception as e:
        logger.error(f"Monitor check failed: {e}")
