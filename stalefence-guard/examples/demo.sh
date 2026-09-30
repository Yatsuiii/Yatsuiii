#!/bin/sh
# Two agents, one repo: watch stalefence catch a clean merge that would break, and hand out
# migration numbers without a collision. Needs `stalefence` on PATH (pip install .).
set -e
D=$(mktemp -d); cd "$D"
export GIT_AUTHOR_NAME=demo GIT_AUTHOR_EMAIL=demo@example.com GIT_COMMITTER_NAME=demo GIT_COMMITTER_EMAIL=demo@example.com
git init -q --bare --initial-branch=main remote.git
git init -q --initial-branch=main seed; cd seed; git remote add origin ../remote.git
mkdir -p app migrations
printf 'BEHIND = "Needs upgrade"\n\ndef status_of(s):\n    return s.get("status")\n' > app/cli.py
: > app/__init__.py; : > app/db.py; : > migrations/060_base.py
printf '{"sequences": {"migrations": {"pattern": "migrations/{n}_*.py", "width": 3}}}\n' > .stalefence.json
git add -A; git commit -qm seed; git push -q origin main; cd ..
git clone -q remote.git agent1; git clone -q remote.git agent2
(cd agent1 && git checkout -q -b agent1 && git config user.email agent1@example.com)
(cd agent2 && git checkout -q -b agent2 && git config user.email agent2@example.com)

echo "== both agents need a migration number"
(cd agent1 && stalefence reserve migrations)
(cd agent2 && stalefence reserve migrations)

echo "== agent1 reads app/cli.py and adds a new use of BEHIND"
cd agent1
stalefence read app/cli.py
printf '\ndef needs_backup(s):\n    return s.get("status") == BEHIND\n' >> app/cli.py
git commit -qam "needs_backup uses BEHIND"
cd ..

echo "== meanwhile agent2 moves BEHIND into app/db.py and lands it"
cd agent2
printf '# BEHIND moved to app/db.py\n\ndef status_of(s):\n    return s.get("status")\n' > app/cli.py
echo 'BEHIND = "Needs upgrade"' > app/db.py
git commit -qam "move BEHIND to app/db.py"; git push -q origin HEAD:main
cd ..

echo "== agent1 is about to push"
cd agent1
stalefence check || true
stalefence merge-check -- python3 -c "import app.cli as c; c.needs_backup({})" || true
echo "(demo repo left in $D)"
