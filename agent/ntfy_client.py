import logging
import os
import time

import httpx

logger = logging.getLogger(__name__)

NTFY_URL = os.getenv("NTFY_URL", "https://ntfy.sh")
NTFY_TOPIC = os.getenv("NTFY_TOPIC", "")

# Rate limiting: minimum 2 hours between proactive notifications
RATE_LIMIT_SECONDS = 2 * 60 * 60
_last_notification_time: float = 0.0


async def send_notification(
    title: str,
    message: str,
    priority: str = "default",
    tags: str = "robot",
    force: bool = False,
) -> bool:
    """Send a push notification via ntfy.sh.

    Args:
        title: Notification title
        message: Notification body
        priority: ntfy priority (min, low, default, high, urgent)
        tags: Comma-separated ntfy tags/emojis
        force: Skip rate limiting (for test notifications)

    Returns:
        True if notification was sent successfully.
    """
    global _last_notification_time

    if not NTFY_TOPIC:
        logger.warning("NTFY_TOPIC not configured, skipping notification")
        return False

    # Rate limiting
    if not force:
        elapsed = time.time() - _last_notification_time
        if elapsed < RATE_LIMIT_SECONDS:
            remaining = int((RATE_LIMIT_SECONDS - elapsed) / 60)
            logger.info(f"Rate limited: next notification in {remaining} minutes")
            return False

    url = f"{NTFY_URL.rstrip('/')}/{NTFY_TOPIC}"

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                url,
                content=message.encode("utf-8"),
                headers={
                    "Title": title,
                    "Priority": priority,
                    "Tags": tags,
                },
                timeout=10.0,
            )
            response.raise_for_status()
            _last_notification_time = time.time()
            logger.info(f"Notification sent: {title}")
            return True

    except Exception as e:
        logger.error(f"Failed to send notification: {e}")
        return False
