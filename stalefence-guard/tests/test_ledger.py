import pytest

from stalefence.ledger import Premises, StalePremise


def test_only_the_keys_an_action_depends_on_are_verified():
    world = {"price": 10, "stock": 3}
    p = Premises()
    p.observe("price", 10)
    p.observe("stock", 3)
    world["stock"] = 2                                   # irrelevant to a price change
    p.verify(world.get, keys=["price"])                  # scoped: fine
    with pytest.raises(StalePremise):
        p.verify(world.get)                              # whole read set: aborts


def test_reobserving_refreshes_and_unobserved_keys_are_an_error():
    world = {"k": 1}
    p = Premises()
    p.observe("k", 1)
    world["k"] = 2
    assert p.changed(world.get) == {"k": (1, 2)}
    p.observe("k", world["k"])
    assert p.changed(world.get) == {}
    with pytest.raises(KeyError):
        p.verify(world.get, keys=["never-read"])


def test_guarded_decorator():
    world, sent = {"booking": "blocked"}, []
    p = Premises()
    p.observe("booking", "blocked")

    @p.guarded(world.get, keys=["booking"])
    def retract():
        sent.append("retraction")

    world["booking"] = "confirmed"
    with pytest.raises(StalePremise):
        retract()
    assert sent == []
