# Inkwash: design draft

*Working name. 2026-10-01. "You" means Raghav, the first creator.*

> **Status: v0 is built** (`v0/`, live at https://claude.ai/artifact/TxYpHeRRTDSLLg9mPj3DeK).
> It covers section 12, plus a minimal publish and reader view so stage 0 can happen. Where it
> differs from this design is listed in `v0/README.md`.

**In one line:** you paint the shape of a story, the AI inks it in, and the world keeps track of
every fact. Other people can visit it, and when you choose, producers and game developers can
license it.

## 1. Who it's for

Three groups, in the order we need them:

1. **Creators: people with a world in their head.** Most never wrote it down, because the blank
   page was too big or prose isn't their thing. Fantasy and web-novel readers come first: they
   already live in other people's worlds, and many have their own.
2. **Readers: people who want to wander through worlds.** They follow worlds, read the books and
   look things up in the lore.
3. **Buyers: producers, game developers, comic artists and audio studios who need worlds that
   already have fans.** AI is making production cheap: video from Seedance or Higgsfield, and
   cheaper games and comics. As it does, the scarce thing becomes a world worth producing.
   Buyers come last; they follow readers.

Dreams are the origin story and a feature (the dream inbox, section 4), not the marketing. The
pitch is "get the world out of your head."

## 2. Why not just use ChatGPT

A chat assistant is a genie: you wish, it grants, it forgets. Inkwash is a workshop.

| | Chat assistant | Inkwash |
| --- | --- | --- |
| Where your world lives | In the chat history | In the canon: every character, place, rule and secret, stored as facts |
| How you steer | You type requests | You paint the shape, mood and threads, and pin your own lines |
| Fixing one part | Regenerate it, or argue | Repaint that region; nothing else changes |
| Changing a fact | Later scenes silently contradict it | Every scene that relied on it lights up |
| Who wrote what | Unknown | Recorded for every passage |
| Showing it to people | Share a chat log | A world page, a book and a map |
| Getting paid for it | No way to | License it (section 9) |

**Why the big labs won't build this.** They build one assistant for a billion people. This is a
tool with strong opinions for people who live inside worlds, plus a library of readers and a
rights market. That's a whole business, and it isn't theirs. Apple could have built Instagram;
phones already had cameras. The value was in the feel and the feed. The model is ink, and anyone
can buy ink.

**Seedance and Higgsfield aren't competitors.** They make video clips that don't know your world.
Later they become more ink (the canon tells them what a character looks like, every time), and
more buyers.

**Other tools nearby, and the gap:**
- AI writing tools (Sudowrite, NovelCrafter, NovelAI) help novelists write prose, using story
  bibles or lorebooks.
- Worldbuilding tools (World Anvil, Campfire) organize worlds. People already pay for them just
  for that.
- Reading platforms (Wattpad, Webtoon, Royal Road) host stories and already feed publishing and
  adaptation deals.

Here's the gap, as far as we know: none of these let you paint a story's shape, flag the scenes
a canon change breaks, or carry a record of authorship into a rights market. Check this before
saying it publicly.

**The one risk that matters is slop.** If anything reads like generic AI prose, we lose. Every
design rule below exists to keep your hand visible.

## 3. The feel

- **Paper and ink, not a dashboard.** The main canvas looks like a painted scroll.
- **No chat box in the main flow.** You never talk to the AI; you paint, pin and write. The AI
  answers only in wet ink and margin suggestions.
- **Wet ink.** Everything the AI writes stays visibly wet until you set it. Nothing wet can be
  published.
- **Your hand shows.** While you work, your own sentences look slightly different from inked ones,
  so you always know which parts are yours.
- **Repaint, don't regenerate.** Fixing one part never touches the rest.

## 4. The loop

**Dream → World → Score → Book → Library → Market**

1. **Dream.** You catch fragments in the dream inbox: a dream, a daydream, a line that hit you in
   the shower. The AI suggests seeds (a place, a creature, a rule, a character). You keep the ones
   you like.
2. **World.** Seeds become canon: characters, places, factions, rules and secrets, each made of
   facts.
3. **Score.** You paint a book's shape on the canvas (section 5).
4. **Book.** The AI inks the score one region at a time, and you edit, repaint and set. Two
   ledgers keep the story consistent and record who wrote what (sections 6 and 7).
5. **Library.** You publish a world page and the book, and readers follow it (section 8).
6. **Market.** When you choose, you license the world (section 9).

## 5. The brush: painting a score

The canvas runs left to right through the story: chapters, then scenes within them. Lanes run
top to bottom:

| Lane | You paint | What it means |
| --- | --- | --- |
| Tension | One curve | Height is the stakes. A slow rise, a spike, a release. |
| Mood | Washes of color | Each pigment is a feeling you name and define with one line of your own (dread, indigo: *"Something was breathing on the other side of the door."*). Overlaps blend. Opacity is intensity. |
| Pace | Brush width | Thin is fast: short sentences, cuts, action. Wide is slow: lingering, description, inner life. |
| Threads | One line per character | Solid when the character is in the scene, dotted when not. Crossing lines mean they meet, a knot is a fight, and a line ending is an exit. |
| Secrets | A mark where a secret starts | A line runs to a character's thread when they learn it, and to the reader's line when the reader does. You can see dramatic irony at a glance. |
| Pins | Your own sentences, placed on the timeline | They must appear word for word. The AI writes around them. |
| Notes | Margin notes on a region | "She doesn't trust him yet." "It always rains here." |

The tools:
- brush;
- smudge, to blend moods;
- eraser;
- thread pen;
- secret dropper;
- pin;
- **repaint**: select a region, and only that region is inked again.

Every region becomes a brief the model can follow. For example, chapter 6, scene 2:

```
Tension 0.8, rising sharply. Mood: dread 70%, wonder 30%. Pace: slow.
In the scene: Kael and the Hollow Queen. Their threads cross here: they meet for the first time.
Secrets: the reader knows the Queen is Kael's mother. Kael doesn't.
Must include, word for word: "The moon had a door in it, and the door was open."
Notes: she doesn't trust him yet.
Canon: [the facts about Kael, the Queen and this place]
Voice: [three paragraphs of the author's own writing]
```

That brief is the difference from a chat: it's built from what you painted, not from what you
typed.

## 6. Ink, and the continuity ledger (reused from stalefence)

How a region gets inked:

1. **Build the brief** from these parts:
   - the score;
   - the relevant canon;
   - the pins;
   - the end of the previous passage and the start of the next;
   - a voice sample, which is always the creator's own writing and never a famous author's.
2. **The model writes the passage.** It also lists the canon facts it used and any new facts it
   introduced.
3. **Run the checks:**
   - every pin appears word for word (a plain string check);
   - a second pass compares the passage with the canon and flags contradictions;
   - new facts stay suggestions until you accept them.
4. **The passage appears as wet ink.** You edit it, repaint it or set it.
5. **When you set it, the ledger records its premises:** each fact it used, at the version it
   used.

The ledger is stalefence's premise ledger, pointed at a story instead of a repo:

| In stalefence | In Inkwash |
| --- | --- |
| An agent reads a file | A passage uses a canon fact |
| A premise is the file's blob at the merge-base | A premise is the fact's version when the passage was set |
| The check is scoped to files actually read | The check is scoped to facts the passage actually used |
| `--strict` blocks on any movement at all | Strict mode flags any change to any character in the scene |
| Rebasing doesn't refresh a premise; re-reading the file does | Accepting doesn't refresh a premise; re-reading against the new fact does |
| A pre-push check | A pre-publish check: no stale passages go out |
| Reservations and claims, swapped atomically | Canon claims in shared worlds (section 8) |

When a fact changes, every set passage whose premises include the old version turns stale and
glows, on the canvas and in the book. A fact changes when you edit the canon, or when a repaint
changes what happened. You then either ink the stale passage again, or read it and mark it still
true, which records the new version.

## 7. The authorship record

For every passage, Inkwash records:
- which spans you typed or pinned;
- which spans the model inked and you set unchanged;
- which spans the model inked and you edited, and what you changed;
- which spans were pasted in from outside the studio. Their origin is unknown, so they never count
  as yours. Text moved inside the studio (cut and pasted, dragged, undone) keeps its origin;
- the direction you gave it: strokes, notes and pins;
- for every canon fact, whether you wrote it or accepted it from a suggestion;
- when each of these happened.

For a world, that becomes a **provenance report**:
- how much of the text is yours;
- which structure and canon you authored;
- a timeline.

It exports as PDF and JSON. A small **hand meter** shows how much of each chapter is yours while
you work.

**Why it matters (this is not legal advice).** The US Copyright Office's position, from its
January 2025 report on copyrightability, is that material an AI generates from prompts alone isn't
protected. Material a human wrote can be, and so can creative selection, arrangement and editing
of AI output. Registering a copyright means disclosing the AI-generated material and claiming
only the human part. Other countries have different rules. Two things follow:
- A world made mostly by a model may belong to nobody, so nobody can sell exclusive rights to it.
- A buyer's lawyer will ask for chain of title: the documented history of who owns what. The
  provenance report is the evidence.

So "your hand is visible in everything" isn't only about taste. It's what makes a world sellable.
Talk to a lawyer before the market opens.

## 8. The library

- **World page:** cover, map, characters, lore, the books, and a note from the creator. The page
  says plainly what the AI did, taken from the provenance report.
- **Spoiler-safe lore:** secret facts stay hidden until the reader reaches the chapter that
  reveals them.
- **Reading view:** clean typography, chapter by chapter. Readers can follow a world to get new
  chapters.
- **Stats for creators:**
  - how many readers;
  - how many finish each chapter;
  - where people stop;
  - which characters readers look up.
- **Shared worlds (later):** a creator can let other people write stories in their world.
  - A guest's story records premises against the host's canon, so if the host changes the canon,
    the guest's affected passages go stale.
  - Before a guest's chapter is published, its premises are checked against the latest canon,
    like a pre-push hook.
  - Canon claims (stalefence's reservations) stop two guests from writing the same event two
    different ways.

## 9. The market

Buyers don't buy dreams. They buy three things, and each one comes from an earlier step in the
loop:

| What buyers need | Where it comes from |
| --- | --- |
| **Proof** that people love the world | Library stats: followers, completion, re-reads |
| **Rights** they can actually acquire | The creator owns the world, and the authorship record proves the human part |
| **A bible** to build from, meaning the reference document for a world | The canon, exported as a series bible (PDF) or as lore files a game can load (JSON: characters, relationships, timeline, maps, how things look) |

Wattpad sells stories; we'd sell worlds with the bible already written.

There are three kinds of license:

| License | For | Terms | Price |
| --- | --- | --- | --- |
| Fan | Readers and fan artists | Non-commercial, with credit, under the creator's rules | Free |
| Indie | Small game studios, comic artists, audio dramas, AI filmmakers | Not exclusive. Commercial use up to a revenue cap. The bible export is included. | A fixed price set by the creator |
| Studio | Producers, publishers and larger studios | An exclusive option for a set term, then a purchase price | Negotiated |

Inkwash hosts the listing, the standard contracts, the provenance report and the bible export. It
takes a commission, the way an agent does; literary agents typically take 15–20%.

Three rules make creators trust it:
- **Creators own their worlds.** Inkwash's license covers only hosting, displaying and promoting
  them.
- **Licensing is opt-in,** world by world.
- **Worlds are never sold or licensed as AI training data,** and every license forbids training
  on them.

**Precedent.** Web-novel platforms already turn stories into films, shows and games:
- *The Kissing Booth* went from Wattpad to a Netflix film.
- *Solo Leveling* went from a Korean web novel to a webtoon, then an anime and a game.
- Naver bought Wattpad for about $600M in 2021.

There's a warning too. In 2020, China Literature (Yuewen) changed its author contracts in ways
its authors saw as a grab for their rights, and they protested en masse. Take creators' rights
and they leave.

## 10. Business model

- **Creators:** free to start. Inking costs compute, so a paid tier covers heavier inking, more
  worlds and exports.
- **Readers:** free. Paid chapters, as on web-novel platforms, could come later if creators want
  them.
- **Market:** a commission on licenses.

The first version has none of this: it's free, and it runs on your own Claude account.

## 11. Architecture

### v0: one page, published as a claude.ai artifact

There's no server and no API key. The page uses four platform capabilities:

| Capability | Used for |
| --- | --- |
| `sample` | Inking, seed suggestions, continuity checks, plates, dreaming worlds and exploring them. Calls run on the viewer's own Claude account after the viewer allows it. Inking, dreaming and drawing an atlas use the `complex` tier; checks, plates and exploring use `default`; seeds use `quick`. |
| `db` | All of the world's data, stored as documents (layout below). |
| `user` | `isOwner()` picks the view: the owner gets the studio, and everyone else gets the book. |
| `downloads` | Exports: the book (EPUB, HTML, Markdown, PDF), the bible (JSON) and the provenance report. |

The `db` layout keeps every document well under the 256 KiB limit:

```
studio/<world>                     world settings, pigments, voice sample    owner only
studio/<world>/canon/<entity>      one entity and its versioned facts        owner only
studio/<world>/chapters/<ch>       that chapter's strokes, pins and notes    owner only
studio/<world>/passages/<id>       text, authorship spans, premises, state   owner only
studio/<world>/seeds/<id>          the dream inbox                           owner only
studio/<world>/plates/<id>         a plate's composition                     owner only
studio/<world>/atlas/main          the world's map: its shape and places     owner only
published/<world>/...              the book and the public lore              signed-in viewers can read
```

Access rules: `studio` is owner-only for both reading and writing, so secrets and drafts never
reach readers. `published` can be read by everyone the page admits, and only the owner can write
to it.

**What v0 can't do:**
- It has one creator and one world.
- Readers must be signed in to claude.ai to see the live page, so the book also goes out as an
  exported EPUB or HTML file.
- There are no payments and no way to discover other worlds. Its only images are the atlas and the plates.

That's enough for stage 0.

### v1: a standalone web app, when the library opens

- **Web client:** the canvas, the editor and the reader.
- **API server and Postgres:**
  - worlds, entities and versioned facts;
  - chapters, strokes, pins and passages;
  - authorship spans and premises;
  - claims and licenses.
- **Ink worker:** a job queue that builds briefs, calls the model, runs the checks and records
  premises.
- **Ledger:** the stalefence logic, ported over:
  - recording premises;
  - finding stale passages;
  - claims with compare-and-swap.
- **Object storage:** covers, maps and exports.
- **Later:** accounts, search, and payments for the market.

The core tables:

```
world(id, owner, title, visibility)
entity(id, world, kind, name)
fact(id, entity, statement, version, origin: human|accepted, visibility: public|secret, revealed_in)
chapter(id, world, book, position)
stroke(id, chapter, lane, path, params)
pin(id, chapter, position, text)
passage(id, chapter, region, text, state: wet|set|stale)
span(passage, start, end, origin: typed|pinned|inked|inked_edited|pasted)
premise(passage, fact, version)
claim(world, key, holder, expires)
license(id, world, tier, terms, buyer, status)
```

## 12. What v0 includes

**In:**
- one world;
- a canon editor for characters, places, rules and secrets;
- the canvas with tension, mood (3–5 pigments you name), threads, pins and notes;
- inking one scene at a time, plus repaint;
- wet ink and setting, the pin check and the continuity check;
- the ledger and the stale glow;
- authorship spans and the hand meter;
- the book view and exports;
- the dream inbox: paste in a fragment, get seeds;
- plates: ink wash paintings of scenes, places and characters, composed by the AI and painted by
  the page;
- dreaming a world: a dream grown by the AI into a whole world (regions, places, peoples, powers),
  kept in the canon as suggestions;
- the atlas: the world drawn as a map, explored one region at a time.

**Out, for later:**
- the pace and secrets lanes;
- the library, other creators and shared worlds;
- the market and payments;
- generated maps, your own uploaded art, voice capture, and mobile.

**Build order:**
1. canon editor;
2. canvas;
3. inking a scene from a brief;
4. pins and checks;
5. ledger and stale glow;
6. book view and exports;
7. dream inbox;
8. hand meter.

## 13. Stages and signals

This is a creative tool, so it doesn't go through the kill screen in `stalefence/DECISION.md`.
That screen was written for business tools that sell relief from a pain. You test a creative tool
by making something with it and watching how people react.

Each stage has a signal to look for before the next one gets built. If the signal doesn't show
up, we fix that stage first.

| Stage | What happens | Signal to move on |
| --- | --- | --- |
| 0. Your world | You build your first world in v0, the one you've wanted to show people for years, and show it to ten fantasy readers | They ask how you made it, or ask for the next chapter |
| 1. Twenty creators | Invite people who have worlds in their heads, from fantasy and web-novel communities | They come back on their own and finish chapters |
| 2. The library | World pages, following and reading stats | Readers finish chapters of worlds they found by themselves |
| 3. The market | Fan and indie licenses first, studio options later | The first paid indie license |

## 14. Risks, and the design rules that answer them

| Risk | Rule |
| --- | --- |
| Slop | Nothing wet gets published. The voice comes from your own writing. Pins and repaint keep your hand in it. |
| Writers who hate AI | Never market "AI writes your novel." Every world page says exactly what the AI did. Lead with the hand. |
| Rights | The authorship record exists from day one, and a lawyer reviews the market before it opens. |
| An empty market | Build the tool, then the library, then the market, starting with your own worlds. |
| Cost | v0 runs on your Claude account. Later, the paid tier covers inking. |
| A big platform copies the editor | The moat is the library, the reader data, the rights records and the creators, not the editor. |

## 15. Open questions

1. What's the name? Inkwash is a placeholder.
2. Which world do you build first?
3. Is v0 prose only, or does it include a hand-drawn map too?
4. Do readers ever ink anything themselves, for example "what if" branches? Probably not, because
   it muddies authorship.
5. Do creators set their own indie license prices, or are prices fixed in tiers?
