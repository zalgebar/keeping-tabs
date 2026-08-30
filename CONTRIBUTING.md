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
| `index.html` | The app. Root, because Pages serves from the root of `main`. |
| `ref/` | The product plan and anything else for reading, not shipping. |
| `vendor/` | Vendored ESM dependencies, committed deliberately. |

## Ground rules

- **No build step.** Hand-written static files, served straight from Pages.
- **No CDN imports.** Vendor dependencies into the repo, or offline breaks
  and the PWA loses its point.
- **`.nojekyll` stays.** Pages must not run Jekyll over these files.

## Milestones

`M1`–`M7` are build milestones, not releases. Only two things ship:
**v1.0 at M5** and **v1.1 at M7**.

Full reasoning for any of this is in [`ref/PLAN.html`](ref/PLAN.html).
