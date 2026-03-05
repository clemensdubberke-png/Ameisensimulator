import json
import logging
import os
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

_calendar_available = False
_service = None

try:
    from google.oauth2.service_account import Credentials
    from googleapiclient.discovery import build

    _calendar_available = True
except ImportError:
    logger.info("Google Calendar libraries not installed, calendar features disabled")


CALENDAR_ID = os.getenv("GOOGLE_CALENDAR_ID", "primary")


def _get_service():
    """Initialize Google Calendar service from credentials in env."""
    global _service
    if _service is not None:
        return _service

    creds_json = os.getenv("GOOGLE_CALENDAR_CREDENTIALS", "")
    if not creds_json or creds_json == "{}":
        logger.info("Google Calendar credentials not configured")
        return None

    try:
        creds_data = json.loads(creds_json)
        credentials = Credentials.from_service_account_info(
            creds_data,
            scopes=["https://www.googleapis.com/auth/calendar"],
        )
        _service = build("calendar", "v3", credentials=credentials)
        logger.info("Google Calendar service initialized")
        return _service
    except Exception as e:
        logger.error(f"Failed to initialize Google Calendar: {e}")
        return None


def get_todays_events() -> list[dict]:
    """Fetch today's calendar events.

    Returns list of {summary, start, end} dicts, or empty list if unavailable.
    """
    if not _calendar_available:
        return []

    service = _get_service()
    if service is None:
        return []

    try:
        now = datetime.utcnow()
        start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_day = start_of_day + timedelta(days=1)

        events_result = service.events().list(
            calendarId=CALENDAR_ID,
            timeMin=start_of_day.isoformat() + "Z",
            timeMax=end_of_day.isoformat() + "Z",
            singleEvents=True,
            orderBy="startTime",
        ).execute()

        events = events_result.get("items", [])
        result = []
        for event in events:
            start = event["start"].get("dateTime", event["start"].get("date", ""))
            end = event["end"].get("dateTime", event["end"].get("date", ""))
            # Format times nicely
            for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S"):
                try:
                    start = datetime.fromisoformat(start).strftime("%H:%M")
                    break
                except ValueError:
                    pass
            for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S"):
                try:
                    end = datetime.fromisoformat(end).strftime("%H:%M")
                    break
                except ValueError:
                    pass

            result.append({
                "summary": event.get("summary", "Kein Titel"),
                "start": start,
                "end": end,
            })

        logger.info(f"Loaded {len(result)} calendar events for today")
        return result

    except Exception as e:
        logger.error(f"Failed to fetch calendar events: {e}")
        return []


def create_event(
    summary: str,
    start_time: str,
    end_time: str,
    description: str = "",
) -> dict | None:
    """Create a new calendar event.

    Args:
        summary: Event title
        start_time: ISO format datetime string
        end_time: ISO format datetime string
        description: Optional description

    Returns:
        Created event dict or None on failure.
    """
    if not _calendar_available:
        logger.warning("Calendar not available")
        return None

    service = _get_service()
    if service is None:
        return None

    try:
        event = {
            "summary": summary,
            "description": description,
            "start": {"dateTime": start_time, "timeZone": "Europe/Berlin"},
            "end": {"dateTime": end_time, "timeZone": "Europe/Berlin"},
        }
        created = service.events().insert(calendarId=CALENDAR_ID, body=event).execute()
        logger.info(f"Calendar event created: {summary}")
        return created
    except Exception as e:
        logger.error(f"Failed to create calendar event: {e}")
        return None
