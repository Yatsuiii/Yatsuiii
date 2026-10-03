# Inkwash creator trial: a kit for two kinds of tryout

*Drafts only. Nothing here has been sent or posted, and nobody has been invited.*

## Two tracks, kept apart

The trial has two experiences, and their feedback must never be mixed.

| | **Track P: the preview** | **Track F: the full experience** |
| --- | --- | --- |
| What they use | `inkwash-offline.html`, one file | Their own trial copy on claude.ai (`TRIAL_SETUP.md`) |
| What it tests | Bringing notes in, the canon, editing, undo, coming back | The whole loop: notes, Ripples with Claude, Claude's answers kept or rewritten, scenes inked and set |
| Claude | None. Ripples opens to "My own idea" only | Claude's ways, answers, inking and checks, on their own Claude usage |
| Who | Anyone with notes, including people with no claude.ai account or no wish to use AI | 3–5 creators with a claude.ai account, each invited by email as an Editor of their own copy |
| Where their world lives | Their browser, on their computer | Their own space in their copy's storage on claude.ai. Its published rules keep it from everyone else, you included, but you could change those rules or the page (`TRIAL_SETUP.md`) |
| Ready? | Yes | A test copy is published for you. Creators wait until your second account has run the whole loop (`TRIAL_SETUP.md`) |

**Never read preview feedback as a verdict on the AI.** Preview users never saw Claude's side.

**Moving between tracks.** A creator can move their preview world into a full copy: Book → Back up
this world in the preview, then Book → Restore a backup in their copy. Their feedback stays filed
under the track it came from.

## What we want to learn

From both tracks:

1. **First useful result:** did they get something worth keeping in their first session?
2. **Voluntary return:** did they come back on a later day without being asked?
3. **Continued development:** did they keep building the same world?
4. **Preferred workflow:** which way in, and which tools, did they actually use?
5. **Willingness to pay:** kept as three things that must never be merged:
   - what they actually pay;
   - what they say they'd pay;
   - what they'd be interested in, hypothetically.

From Track F only:

6. **Does Claude's help help?** Did they use Claude's ways or their own ideas? Did they keep
   Claude's answers as offered, rewrite them, or write their own? Did they ink scenes or write
   them by hand?

A handful of people can't give rates. This gives direction, and the reasons behind it.

## Track P: the preview

**The file:** `inkwash-offline.html`, about 540 KB. Build it with `node inkwash/v0/build.mjs`; it's
written to `inkwash/v0/dist/`.

- **What it needs:**
  - a laptop or desktop;
  - Chrome or Edge, the only browsers it's been tested in;
  - their notes, pasted in or as a `.txt` or `.md` file;
  - no account and no install.
- **Their privacy:** nothing they write leaves their computer. The file's only request is for its
  typefaces, from Google Fonts. It's a plain web page; anyone can open it in a text editor to look
  inside.
- **Where their work lives:** in that browser on that computer. Clearing the browser's data deletes
  it, and a private window forgets it. They should back up from the Book view.
- **Sending it:** as an attachment or a direct message. Some email services flag `.html`
  attachments. Hosting it at a public link is a publishing decision, so make it deliberately.

**Invitation (Track P)**

> Hey! You mentioned you keep notes on your world. I've been building something small for
> exactly that. You paste your notes in, and it turns them into a codex of your world:
> characters, places, rules. When you change a fact, it shows what that touches. It never writes
> anything for you.
>
> Would you try it for a week or two with your own notes? It's one file you open in your browser.
> There's no account, and nothing you write leaves your computer. This copy has no AI in it at
> all. Afterwards I'd ask you three quick questions.
>
> Totally fine to say no.

**The 5-minute guide (Track P, send with the file)**

> **Inkwash in five minutes**
>
> 1. **Open it.** Open `inkwash-offline.html` on a laptop or desktop; it opens in your browser.
>    Chrome or Edge work best. Nothing gets installed.
> 2. **Look first, if you like.** Click **The Hollow Moon**: a made-up book with a scene that went
>    stale when a fact changed. Use the menu at the top to get back.
> 3. **Bring in your notes.** Click **Bring in notes**. Paste them, or open a `.txt` or `.md` file,
>    then click **Read my notes**. You'll see everything it found, line by line.
>    - A heading (`## Harrowgate`) becomes an entry, and the lines under it become its facts.
>    - Headings like *Characters* or *Places* say what the entries under them are.
>
>    Untick what you don't want, fix names, then **Add**.
> 4. **Change something.** In **Canon**, open an entry and edit a fact. Under a fact, click
>    **Ripples**, then write where you think it leads in **My own idea**.
> 5. **Made a mess?** **History**, top right, undoes any step.
> 6. **Back it up.** Your world lives only in this browser. Now and then, go to **Book** and click
>    **Back up this world**. Clearing your browser's data deletes it.
>
> That's all. Come back to it if and when you feel like it. Either way, I'd love to know why.

## Track F: the full experience

**What it needs from each creator:**

- a claude.ai account, signed in;
- an email invitation as an Editor of their own trial copy (you send it from that copy's Share
  menu, with link sharing off);
- their own Claude usage, which claude.ai asks them to allow at the first call.

How it behaves on free plans hasn't been checked (`TRIAL_SETUP.md`).

**What they're told:**

- Their worlds are saved in their own space in their copy. The copy's published rules show that
  space to them alone: not to other visitors, and not to you. The page's banner says this too.
- That's a rule, not a guarantee about you. You own the copy, and a new version of it, with
  different code or rules, could read their worlds. You'll tell them before you publish one.
- Never tell them you *can't* read their worlds.

**Invitation (Track F).** Not ready to send. It's finished once your second account has run the
whole loop, with the setup and limits that run shows (`TRIAL_SETUP.md`).

> Hey! You mentioned you keep notes on your world. I've been building a tool for exactly that,
> and I'd love you to try the full version for a week or two.
>
> You bring your notes in and they become a codex of your world. When you add or change a fact,
> Claude can show you what it breaks and ask where it might lead. Your own idea always comes
> first, Claude's are there to start from, and nothing goes into your world unless you add it.
> You can also have it write a scene from your outline, and you decide what stays.
>
> It runs on claude.ai, on your own Claude account. I'd send you an invite to your own copy.
> What you write there is kept in your own space, and the copy's storage rules don't let anyone
> else read it, me included. I do own the copy, so I could change those rules or the page, and I
> won't without telling you first. Afterwards I'd ask you a few questions.
>
> Totally fine to say no.

**The 10-minute guide (Track F, send with the invitation)**

> **Inkwash, the full version, in ten minutes**
>
> 1. **Open the link** from the invitation email, signed in to claude.ai. The banner at the top
>    says where your worlds are kept, and who the copy's rules show them to.
> 2. **Bring in your notes** (same as the preview): **Bring in notes**, paste or open a file,
>    **Read my notes**, untick and fix, then **Add**.
> 3. **Ripples.** Open an entry in **Canon** and click **Ripples** under a fact. The first time,
>    claude.ai asks you to allow it: it uses your Claude usage. You'll see what the fact breaks,
>    then **My own idea** first, then Claude's ways. Pick one, and write your own answer or start
>    from one of Claude's. Only what you add goes into your world.
> 4. **A scene.** In **Score**, pick a scene and click **Ink this scene**, or **Write it
>    yourself**. If the check finds something that contradicts your canon, keep it or change it,
>    then set the scene with your seal.
> 5. **Change a fact a scene used**, and see the scene flagged. **History**, top right, undoes
>    any step.
> 6. **Back it up** from **Book** now and then: **Back up this world**.
>
> Come back whenever you feel like it, or don't, and tell me why either way.

## For both tracks

### Assisted and unassisted

Alternate within each track, by the order people say yes: P01 assisted, P02 unassisted, and so
on; F01 assisted, F02 unassisted.

- **Assisted:** a 15-minute call. They share their screen and start with the guide while you
  watch. Answer questions, but don't drive.
- **Unassisted:** the guide only. They can message you.

### Prompted and voluntary return

- Send no reminders before day 7.
- On day 7, send one check-in (below).
- Making something on a later day before that message is a **voluntary return**. Anything after
  it is a **prompted return**. Record them in separate columns.

> Hey, quick check-in on Inkwash, no pressure. Whether you've opened it since the first day or
> not, I'd love to hear why, whenever you have a minute.

### Where to find people

1. **First, people you already talk with on X** who have mentioned their own world or their notes.
   Ask one person at a time, in your own words.
2. **r/WritingWithAI** allows a product post in its weekly thread. Re-read its rules on the day
   before posting. Draft:

   > I'm looking for a few people with a world in their head and notes all over the place, to try
   > a tool I'm building. Paste your notes in and it sorts them into a codex: characters, places,
   > rules. You review every line before anything is added. Change a fact later, and it shows which
   > scenes relied on it. There's a no-AI preview that runs from one file in your browser, and a
   > full version on claude.ai where Claude suggests where a fact might lead, with your own idea
   > always first. DM me if you're up for it.

3. **Don't recruit in r/worldbuilding**, which restricts AI content, or in r/WorldbuildingWithAI,
   which prohibits promotion. Re-check any other community's rules first.

## Questions (day 10 to 14)

Ask about one track at a time. If someone tried both, ask the three questions twice, naming which
one you mean each time, and file the answers under that track.

**The three questions, both tracks, word for word:**

1. What did you try to make, or do, with it?
2. What interrupted you, or got in your way?
3. Did you come back to it on another day? Why, or why not?

**Track F only, after those:**

4. When you used Ripples, did you go with your own idea or one of Claude's? Why?
5. When Claude offered answers, did you keep one as it was, change it, or write your own?
   Was there one you wished it hadn't offered?
6. Did you have it write a scene, or write it yourself? If it wrote one, what did you keep?

**About paying (last, optional, both tracks).** Record each answer in its own column:

- **Actual payment.** Nobody can pay in this trial, so record "none" for everyone. As context, in a
  separate column, ask: "Do you pay for anything you use for your world today? What, and about how
  much?"
- **Stated willingness.** "Would you pay for Inkwash as it is now? If so, roughly how much, and how
  often?" Record their words, not your reading of them. For Track F, note that they already spend
  their own Claude usage.
- **Hypothetical interest.** "Would it change your answer if it [kept your world in your account
  rather than one browser / let Claude suggest where a fact might lead]?" Ask one at a time, and
  only about things that track didn't have.

Don't suggest a price, and don't promise features or unlimited anything.

## Their activity, if they choose to share it

Both versions count what a creator does, day by day. The count records no words and no world
names, and stays with them.

- **To share it:** History, then **My activity, in numbers**, then **Copy** or **Save as a file**,
  then send it to you if they want to.
- **If they don't share it:** that's fine. Use their answers.

Track F counts show whether Claude's help was used: "ripples decided from Claude's answers" and
"scenes inked by Claude", against "in my own words" and "stretches of writing in scenes". A
preview count looks like this:

```
# My Inkwash activity
Made by Inkwash on 2026-10-09, from counts only: none of my worlds' words are in here.
- Days I made something in my own worlds: 2 (2026-10-05, 2026-10-08)
- Days I only tried an example world: 1
- World 1: 2 days, from 2026-10-05 to 2026-10-08. 10 facts written in my own words, 23 facts brought in from my notes, 9 new entries, 1 ripple decided in my own words, 2 facts reworded or retired, 1 change undone
```

It only counts changes. A day they opened their world just to read it doesn't show, so ask
question 3 as well.

## The tracker

Keep the filled-in tracker private, outside the repository. One row per person per track: someone
who tried both has a P row and an F row.

**Definitions:**

- **First useful result:** the first time they say they got something they'd keep or use.
  - Examples: their notes as a canon they'd actually use; a stale scene or contradiction they
    hadn't seen; a ripple question that moved their world; a scene they kept.
  - Record what it was and, if you were on the call, about how many minutes in.
  - "It's cool" isn't a result.
- **Voluntary return:** they made something in their own world on a calendar day after their
  first, before the day-7 check-in. The evidence is the activity summary's days, or their answer
  to question 3.
- **Prompted return:** the same, but only after the check-in.
- **Same world continued:** on a later day, at least one meaningful creation action in the world
  they started, not a new world and not an example.
- **Meaningful creation actions:**
  - facts written in their own words, or brought in from notes and kept;
  - suggestions from Claude kept;
  - new entries;
  - ripples decided;
  - questions saved for later;
  - writing in scenes, and scenes inked;
  - scenes set.

  Not counted: opening the studio, reading, exploring an example, undoing.
- **Preferred workflow:** how they started (notes, from nothing, an example first) and what they
  went back to (the canon, ripples, scenes, the map).
- **Claude's help (Track F):** own ideas against Claude's ways; Claude's answers kept, rewritten,
  or passed over for their own; scenes inked against written by hand. Take these from the
  activity counts where shared, and from questions 4–6.

**The table:**

| ID | Track | Onboarding | Started | First useful result (what, minutes) | Voluntary return (dates) | Prompted return (dates) | Same world continued | Meaningful actions (from summary) | Preferred workflow | Claude's help: ways, answers, scenes (F only) | Pays for related tools now | Actual payment | Stated willingness to pay | Hypothetical interest | Summary shared | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F01 | full | assisted | | | | | | | | | | none | | | | |
| F02 | full | unassisted | | | | | | | | | | none | | | | |
| F03 | full | assisted | | | | | | | | | | none | | | | |
| P01 | preview | assisted | | | | | | | | — | | none | | | | |
| P02 | preview | unassisted | | | | | | | | — | | none | | | | |
| P03 | preview | assisted | | | | | | | | — | | none | | | | |

Add F04–F05 and more P rows as people say yes.

## What's collected, and what isn't

- **Collected:**
  - their answers;
  - their activity summary, if they choose to share it;
  - your notes from assisted calls.
- **Never collected:**
  - their notes or their world. In Track F, their copy's rules keep their worlds from you as
    well. Don't publish a version of their copy that would change that;
  - anything gathered automatically: neither version has telemetry.
- **Quoting:** ask before quoting anyone publicly, even without a name.
- **Deleting:** delete someone's row if they ask. When a Track F creator is done, ask whether
  they want their copy deleted, after they've backed up.

## Schedule

| Day | What happens |
| --- | --- |
| Before day 0 | Track F only: the runbook in `TRIAL_SETUP.md`, steps 1 and 2, on yourself and a second account. |
| 0 | Invite. Send the file and guide (P), or publish the copy, send the invitation and guide (F). |
| 0 to 3 | They start. Assisted calls happen here. |
| 7 | The one check-in. |
| 10 to 14 | The questions for their track, about paying, and the activity summary if they'll share it. |
| 14 | Fill in the tracker, by track, and read it against `NEXT_DIRECTION.md` ("After the trial"). |
