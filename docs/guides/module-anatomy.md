# Anatomy of a module - a guide for people

This document explains, in plain words, what a module is in Mission Deck. No jargon, no rulebook.
You do not need to remember it - come back when you lose the thread.

## What a module is

A module is **your own piece of the application**. You add it from the side and the core stays
untouched. You get your own page in the left menu, your own screen and, if you want, your own data.

The left menu has eight fixed drawers (hubs): Team, Activity, Finance, Initiatives, Support,
Knowledge, Design and Apps. They belong to the core, not to modules - in the manifest you choose
which drawer your screen goes into; you do not create your own. That way the menu does not grow
with every new module, and two modules on the same topic sit next to each other. Missing a drawer
you really need? Propose it - it gets added to the core.

Separately you choose a **business area**, such as Product, Engineering or Operations. The area
says what the module is about; the drawer says where you find it. Each module has one area, and
both lists in Settings can be filtered by it.

Think of Mission Deck as an office building. The core is the lobby, the lifts and the wiring. A
module is your room: you furnish it your way and nobody else has to know anything about it.

**The most important thing to start with:** the `modules/` folder is invisible to the core's git.
Whatever you build there **cannot break the shared application**. It is a sandbox. Experiment
without fear.

## The four parts of a module - and when you touch them

A module is one folder with four things inside. At the start you mostly care about the first two.

| Part | What it does | When you look at it |
|---|---|---|
| `module.json` | **The manifest.** Name, business area, icon, which menu drawer the module goes into, how many screens it has and what they are called. | When you change the name, area, icon, drawer or add a screen. |
| `client/index.js` | **What you see.** Code that draws your screen in the browser. | Almost always. This is where your feature lives. |
| `server/index.js` | **What you do not see.** Needed when the module has to compute something, save to disk or ask an outside system. | Only when the screen alone is not enough. |
| `tests/` | **Quality control.** Checks that the module has not drifted. | You do not write anything by hand - `/new-idea` adds the tests. |

If your module only shows something on screen, you can leave out `server/` entirely.

## How the work goes - step by step

This is the loop you will live in during stage 3 of the Academy. It looks the same whatever you build.

1. **Scaffold it.** One command in the terminal creates a ready, working, still empty module. You
   also give your area with `--area`, for example `--area "Product"`. You never start from a blank page.
2. **Enable it and restart the server.** The module shows up in the left menu. A restart is needed
   every time a module appears, disappears or changes its manifest.
3. **Grow it by talking.** Type `/new-idea`, say what you want and in which module. The agent plans,
   shows the plan for approval, and only then writes code and tests.
4. **Check it in the browser.** Refresh, open your screen, look. Something is off - go back to step 3
   and say what to fix.
5. **Share it.** Export to a zip file (for one person) or publish to the catalog (for everyone).

Repeat steps 3 and 4 as many times as needed. That is normal - nobody gets it right first time.

## One screen or several

When you create a module you pick one of two shapes. You can change it later.

- **One screen.** Click the menu item and you are there. Pick this if unsure - simpler is better.
- **Several screens.** Click the menu item and a list of sub-pages opens. Worth it only when you
  really have two different things to show.

## Four things worth knowing up front

**Restart the server after every manifest change.** A new module, enabling, disabling, a new
screen - the server reads manifests only at start-up. Screen code itself reloads with a plain `F5`.

**You do not touch core files.** The menu and the routes are built automatically from your
manifest. If you ever feel like registering a module by hand in core files, something went wrong.

**Human words for people, plain identifiers for machines.** Everything a person reads - the module
name, labels, messages - is written as normal English. Everything a computer reads - the module
id, file names, addresses - stays lowercase ASCII without spaces: `my-module`, not `My Module`.

**Your module has its own version history.** From the very first moment you can go back to an
earlier state if something goes wrong. The module card in Settings shows whether there are unsaved
changes, and **Save version** records the current state with your own description. An older module
without that history gets an **Initialise repository** button instead - one click and it joins the
same mechanism.

## When something does not work

| Symptom | Most common cause |
|---|---|
| The module is not in the menu | It is not enabled, or the server was not restarted. |
| The item is there but the screen is empty | The screen code does not draw anything yet - that is the starting state, not an error. |
| The module disappeared after a restart | The manifest has an error. Settings > Modules shows the reason on the module card. |
| I do not know what next | Type `/new-idea` and describe the problem in your own words. You do not need to know file names. |

## I want to know more

The full technical contract - every manifest field, everything the server layer can do, the
publishing rules - is in `modules-template/README.md`. You do not need it to build your first
module. Look there when this guide stops being enough.
