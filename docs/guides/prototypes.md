# Prototypes - a guide for people

This document explains what prototypes are in Mission Deck and what you can do with them. No
jargon. You do not need to remember it - come back when you lose the thread.

## What a prototype is

A prototype is **a working screen that does not exist in the product yet**. Clickable, opened in a
browser, built with the Design System - but with no real data and no back end. It serves one
purpose: to show an idea before anybody builds it.

## Where it is

**Left menu > Design > Prototypes.**

You see a list of cards. Each card is one prototype: its name, the discovery initiative it belongs
to, the faces of the people responsible and the date of the last change. Above the list is a
search box - it searches **by prototype name and by initiative name**, i.e. everything you see on
the card. It ignores letter case and accents. Next to it is an owner filter when the registry has
more than one person responsible. Both work together.

The same bar has two more buttons: **How it works** opens this guide, and **Add prototype** creates
a new entry.

Clicking a card opens that prototype's page.

## An empty list is not a failure

Prototypes do not live in the app. They live in the **team data** (source `data-tier-0`, folder
`prototypes/`) and must first reach your machine.

If the list is empty and says so, open **Sync** in the top bar, find the team data row and pull
it. If the row says `not decrypted` or `no key`, the data arrived but is unreadable without the
encryption key - set the key in **Settings > Keys** or in the first-run wizard.

After the pull the list refreshes by itself. No page reload needed.

## A prototype's page

| What is there | What it is for |
|---|---|
| **Run prototype** | Opens the **published** version in a new browser tab. |
| **Local preview** | Builds the prototype on your machine from what you have on disk and opens it in a new tab - before anybody else sees it. The first run takes longer (installing dependencies); later runs are quick. |
| **Publish** | Sends the prototype to the team's hosting. Before anything happens the app shows a window describing what it is about to do and waits for confirmation. |
| **Starter prompt for the assistant** | A ready line to paste into Claude Code: the name, id and file location of this prototype. You only add the scope of work. There is a copy button next to it. |
| **Access code** | A six-digit code that opens the prototype on a tester's phone. It is a convenience shortcut, not security. |
| **People responsible** | Who to ask when something is unclear. |
| **Scope** | What the screen covers and what it deliberately does not - if the author wrote it down. |
| **Initiative** | Which discovery initiative the screen belongs to. |
| **Edit** / **Delete** | Rename and change the people responsible, or delete the prototype. |

Not every prototype has a scope or an access code. The page then says plainly that the file is
missing - a normal state, not an error.

## Adding a prototype

On the list, next to the search box, is **Add prototype**. Give it a name and tick the people
responsible. That is all.

The form creates **a registry entry and a working starting point** - one **empty screen** for the
prototype's content, with a default, empty, loading and error state. If the starter files cannot
be created, no entry is created at all - no empty card is left behind.

Further work (real content, extra screens) happens in Claude Code. A new prototype's page has a
ready **starter prompt for the assistant** - copy it, paste it into Claude Code and add what the
screen should do. The prompt carries the prototype's id, so the assistant works on the same files
you see on the list, not on a separate copy.

The order that works: **Add prototype > copy the prompt > the assistant builds the screen > Local
preview > Publish.** The preview shows your local work before you share it; publishing is a
separate, confirmed step.

## How it reaches the team

Everything you change - a new prototype, a rename, a deletion - first lands **only on your
machine**. It reaches the team only when you send the team data through **Sync**.

It works both ways: to see someone else's change you have to pull. **Check server** in the sync
window tells you whether anybody sent something.

Deleting a prototype also deletes its files. After you send through Sync it disappears for
everyone. The app asks for confirmation and names those consequences - read before you click.

**Publish does not replace Sync.** Publishing sends the prototype to the hosting, not to the data
repository. If you publish and do not send the team data, the team sees the new version at the
prototype's address while everybody's Mission Deck still holds the old one, and the next person to
press Publish would roll your work back on the hosting. So before every publish the app compares
the published version with the data repository's history and - when the published version never
went through it - stops with a list of files and a **Publish anyway** button. The usual path: sync
the data on the machine that published, pull it on yours, then publish. "Anyway" is for when you
know the local version should replace the published one.

## What works, and what deliberately is not there

| What | State |
|---|---|
| **List, prototype page, add, edit, delete** | Works. Data reaches the team through Sync. |
| **React starter after "Add prototype"** | Works. A new entry always has source files; without them no entry is created. |
| **Starter prompt for the assistant** | Works. One prompt, the same id as on the list. |
| **Local preview** | Works on any machine with Node.js - the first run installs the build environment (a few minutes), later runs take seconds. |
| **Publishing from the app** | Works when `.env` sets the publish repository (`PROTO_BUILD_REPO_URL`) and the hosting address (`PROTO_PAGES_BASE_URL`). It finishes outside the app: the result goes into that repository and the hosting serves the new version a few minutes later. "Publish started" means "sent", not "already visible". |
| **A design-compliance review tab** | Not there and not planned. Screen quality is judged in Claude Code while the screen is built. |
| **Removing the published version from the hosting** | Not there. Deleting in Mission Deck removes the entry and the source files in team data; the version at the prototype's address stays until somebody removes it in the shell repository. |

## Prototypes in the menu and the `/prototype` command - one registry

The prototype you see in **Design > Prototypes** and the prototype the `/prototype` command builds
in Claude Code are **the same entry**, in one data source (team data, locally
`data-sub-repositories/ds-data/prototypes/`). `/prototype` creates no separate registry or folder -
it creates a new entry through the same `POST /api/prototypes` the **Add prototype** button uses,
and keeps working on the returned id.

If the team keeps a folder of reference screens in its data (`reference-screens/` with a
`manifest.json`), `/prototype` offers screens from it to rebuild or draw on before it plans a new
one. Without it the command simply asks whether you have a reference.

New screens are React (`index.tsx`); a few older prototypes in the same registry still use a
simpler non-React form (`render.js`) and can still be developed - but a new prototype always
starts as React.

## When something does not work

| Symptom | What it means |
|---|---|
| Empty list, a message about team data | Team data not pulled or not decrypted - see "An empty list is not a failure". |
| Empty list, an error message and a Refresh button | The server did not answer. Press Refresh; if still nothing, check the app is running. |
| Search finds nothing | Prototypes exist, none matches the phrase. Clear the box. |
| Run prototype opens a blank page | The prototype was not published at that address yet. Ask the person on the card, or publish it. |
| Local preview reports a missing library | The prototype imports a library the build environment lacks (for example a licensed scheduler). The message names the package. |
| After publishing the address still shows the old version | The hosting is still building the new version - wait a few minutes and refresh. |
| Publishing stopped: "the published version never went through the shared repository" | Somebody published from a machine that never sent its team data, so your local copy is older than the hosted one. Ask them to Sync > Send, pull on your side and publish again. "Publish anyway" only when your local version should deliberately replace the published one. |
| The prototype page warns there are no source files | An older entry without `index.tsx`. Copy the starter prompt to the assistant - it creates them on the same id. |
| A change is not visible to a colleague | It was not sent - open Sync and send the team data. |
