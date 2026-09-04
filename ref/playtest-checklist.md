# Play-test checklist

Build: **0904-01** · Tracked in issue #53 · Now at **keepingtabs.zalgebar.com**

Date: ________  Game: ________________  Players: ____  Device: ________

---

## First, the three that could change the product

Everything else is detail. These are the ones worth interrupting a game for.

- [ ] **Is round entry real or ceremony?** Time it. Four sequential panels vs. one Enter round.
      Sequential: ______ sec   Round entry: ______ sec
      *If they tie, the feature is decoration and should come back out.*

- [ ] **Does anyone reach over to tap someone else's tab?**  Who / how often: ____________
      *This is the declined scorekeeper roster showing up in behaviour rather than opinion.
      Self-entry has no fallback now, so this is the load-bearing observation.*

- [ ] **Does the centre of the table stay free?**  Yes / No / Partly: ____________
      *The whole premise rests on this and one session is the only evidence so far.*

---

## Round entry (new — #52)

- [ ] Do people actually enter at once, or take turns anyway out of politeness?
- [ ] Does the fold-back make the wait legible, or does the slow player just feel watched?
- [ ] Any collisions — two people reaching across each other?
- [ ] Is `−` / `+` enough, or does someone want to type a number?
- [ ] Does anyone tap End round before everyone is in? (It is disabled — watch for the failed tap.)
- [ ] On a phone: does it clip badly enough to be useless? (Steppers measure 63pt.)

Notes: ______________________________________________________________

## Locked vs Arrange (changed)

- [ ] With Locked on, try hard to move a tab — rest a thumb, press, drag. Does it hold?
- [ ] Does anyone get stuck, not realising Arrange exists?
- [ ] Does Arrange get left on by accident?

## Identity editing (changed)

- [ ] **Does anyone still land in the name editor by accident?** ← could not reproduce; want a repro
- [ ] Can a player rename themselves unaided? (Drawn keyboard is 6 columns, not QWERTY.)
- [ ] Does anyone find *More emoji…*? Does the sideways keyboard actually bother them?
- [ ] Does anyone want a colour outside the sixteen, and do they find *More colours…*?

## Size and reach

- [ ] Does anyone turn on Large? Do they keep it on?
- [ ] Is Small fine at its original size, or does someone want the middle?
- [ ] With a full table seated, is the far edge genuinely reachable?
      *This is the finding that reshaped panel sizing, and it came from one session.*

## Colour and legibility

- [ ] Are the vibrant colours distracting during play, or does ambient dim handle it?
- [ ] Can everyone find their own tab at a glance across the table?
- [ ] If anyone picks a light colour, does the text flip to black and stay readable?
- [ ] Does anyone pick a duplicate colour? Does it cause confusion?

## Rounds and the model

- [ ] Does the rounds table read correctly mid-game?
- [ ] Does anyone need to correct a previous round — and can they?
- [ ] Undo after a round ends: does it do what people expect?
- [ ] Phase 10 / 5 Crowns: does *start round at* behave?

## Does the data survive a week

The one test that needs calendar time rather than a session. Safari deletes
script-writable storage — localStorage included — after 7 days of *browser
use* without interaction with the site. Apple's position is that home-screen
web apps keep their own counter and are exempt, but that statement is from
2020 and has never been checked here.

The hub's diagnostics box reports this for you — tap the build number at the
bottom of the hub and read the `age` line: *"8.3d since first write, 2s since
last"*. No need to remember dates. "Reset scores" keeps that clock running;
"Start over" restarts it, because that is genuinely a new store.

- [ ] Installed to the Home Screen from **keepingtabs.zalgebar.com**, play a
      game, leave it. Open it 8+ days later, having used the iPad normally
      in between — Safari has to be *used*, the clock counts browser-use days,
      and don't open the installed app in between or its own counter resets.
      Scores still there? ______   age line read: ______
- [ ] Same again in a **Safari tab** rather than installed. This one is
      expected to lose the data — worth confirming, because it tells you what
      a player who never installs it experiences.
- [ ] Anything left on the old `zalgebar.com/keeping-tabs/` origin is gone
      from the app's point of view. Not a bug.

If installed survives and tab does not, the install prompt (#27) stops being
a nicety and becomes the thing that protects a game in progress.

## Physical and environmental

- [ ] Screen ever sleep mid-game? (Wake lock.)
- [ ] Does ambient dim fire at a bad moment — mid-thought, mid-reach?
- [ ] Anyone rotate the device? Does everything survive?
- [ ] Battery over a full session: ______
- [ ] Device moved on the table? Does anyone re-arrange tabs to match?

## The premise itself

- [ ] Does anyone mention the rotation unprompted — either way?
- [ ] Would anyone open this again next week, or reach for a notepad?

---

## Anything that surprised you

Worth more than every ticked box above. Quotes especially.

