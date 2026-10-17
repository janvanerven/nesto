"""In-memory AI call limits: per-household daily cap and per-user burst cap."""

import time
from collections import deque

from fastapi import HTTPException

DAILY_LIMIT = 200
BURST_LIMIT = 10
BURST_WINDOW_SECONDS = 60

# household_id -> (utc day number, count)
_daily: dict[str, tuple[int, int]] = {}
# user_id -> timestamps of recent calls
_bursts: dict[str, deque[float]] = {}


def check_and_count(household_id: str, user_id: str) -> None:
    now = time.time()
    day = int(now // 86400)

    d_day, d_count = _daily.get(household_id, (day, 0))
    if d_day != day:
        d_count = 0
    if d_count >= DAILY_LIMIT:
        raise HTTPException(429, "The assistant has reached today's limit for this household. Try again tomorrow.")

    stamps = _bursts.setdefault(user_id, deque())
    while stamps and now - stamps[0] >= BURST_WINDOW_SECONDS:
        stamps.popleft()
    if len(stamps) >= BURST_LIMIT:
        raise HTTPException(429, "Slow down a little — try again in a minute.")

    stamps.append(now)
    _daily[household_id] = (day, d_count + 1)


def reset() -> None:
    _daily.clear()
    _bursts.clear()
