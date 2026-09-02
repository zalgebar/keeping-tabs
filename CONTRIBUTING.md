# Working on Keeping Tabs

## Every commit references an issue

Put the issue number in the subject line. Use `Closes #N` in the body when
the commit finishes the issue; a bare `#N` when it is one step of several.

```
Add nearest-edge projection to tab drag (#3)

Projects the pointer onto the nearest of the four edges, then clamps
along that edge to a fraction.

Closes #3
```

If there is no issue for what you are about to do, open one first. The
issue is where the reasoning lives; the commit is only the change.

## Layout

| Path | Holds |
| --- | --- |
| `index.html` | Markup only. Root, because Pages serves from the root of `main`. |
| `app.css` | Every style. |
| `app.js` | The whole program. |
| `ref/` | The plan, the play-test checklist, anything for reading rather than shipping. |
| `vendor/` | Vendored ESM dependencies, committed deliberately. |

`app.js` is a **classic script, not a module**. That is the reason it is one
file: without a build step, splitting it further means either ES modules —
which browsers refuse to load over `file://`, so `index.html` would stop
opening from disk — or several classic scripts sharing one global scope in a
load order nothing enforces. Neither is worth it at this size. Its sections
are marked with banner comments; if it outgrows them, split it then and
accept the constraint knowingly.

## The build number stamps itself

`BUILD` in `app.js` is what the hub prints, and what you read off a screen
mid-game to confirm a device is running what you think it is. A pre-commit
hook stamps it, so it identifies the **deploy** rather than the script — when
it was edited by hand it only moved if `app.js` moved, so a commit touching
only `index.html` or an icon shipped while the hub kept reporting the
previous build.

Hooks are not cloned. Once per checkout:

```
git config core.hooksPath .githooks
```

`MMDD-NN`, sequence restarting each day. Deliberately not the git hash: it
has to be readable off a tab across a table.

## Running it locally

Open `index.html` from disk and it works. For anything touching storage,
serve it instead — `localStorage` is unavailable on `file://`, so the app
reports `no storage` and nothing persists:

```
python3 -m http.server 8137
```

Then <http://127.0.0.1:8137/>. Persistence, reloads and the PWA manifest all
need a real origin.

## Ground rules

- **No build step.** Hand-written static files, served straight from Pages.
- **No CDN imports.** Vendor dependencies into the repo, or offline breaks
  and the PWA loses its point.
- **`.nojekyll` stays.** Pages must not run Jekyll over these files.
- **Three files ship.** A service worker (#25) has to precache `index.html`,
  `app.css` and `app.js`, not just the one.

## Milestones

`M1`–`M7` are build milestones, not releases. Only two things ship:
**v1.0 at M5** and **v1.1 at M7**.

Full reasoning for any of this is in [`ref/PLAN.html`](ref/PLAN.html).
