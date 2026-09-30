"""Premises for any system, not only git: record the version of each fact an action depends on
when it is read, and verify just those versions right before the action runs.

    premises = Premises()
    booking = calendar.get(booking_id)                  # anything with a version: ETag, updated_at
    premises.observe(("booking", booking_id), booking.etag)
    ...
    premises.verify(lambda key: calendar.get(key[1]).etag, keys=[("booking", booking_id)])
    send_retraction(...)                                # only reached if nothing moved

Verifying only the keys an action depends on (not everything ever read) is what keeps false
aborts low: in the stalefence day-2 replay, that dependency scoping had about half the false
aborts of re-checking the whole read set.
"""
from __future__ import annotations

import functools
from typing import Any, Callable, Hashable, Iterable


class StalePremise(Exception):
    def __init__(self, changed: dict):
        self.changed = changed
        super().__init__("premise changed since it was read: " +
                         "; ".join(f"{k!r}: {a!r} -> {b!r}" for k, (a, b) in changed.items()))


class Premises:
    def __init__(self):
        self._seen: dict = {}

    def observe(self, key: Hashable, version: Any) -> None:
        """Record (or refresh, on re-read) the version of `key` the agent is now relying on."""
        self._seen[key] = version

    def forget(self, key: Hashable) -> None:
        self._seen.pop(key, None)

    def keys(self) -> list:
        return list(self._seen)

    def changed(self, current: Callable[[Hashable], Any], keys: Iterable | None = None) -> dict:
        out = {}
        for k in (self._seen if keys is None else keys):
            if k not in self._seen:
                raise KeyError(f"{k!r} was never observed; read it before acting on it")
            now = current(k)
            if now != self._seen[k]:
                out[k] = (self._seen[k], now)
        return out

    def verify(self, current: Callable[[Hashable], Any], keys: Iterable | None = None) -> None:
        changed = self.changed(current, keys)
        if changed:
            raise StalePremise(changed)

    def guarded(self, current: Callable[[Hashable], Any], keys: Iterable | None = None):
        """Decorator: verify `keys` (default: every premise) before each call of the action."""
        def wrap(action):
            @functools.wraps(action)
            def run(*args, **kwargs):
                self.verify(current, keys)
                return action(*args, **kwargs)
            return run
        return wrap
