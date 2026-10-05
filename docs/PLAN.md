# Family Feud — Build Plan

Private Family Feud web app for one family visit: about 15 people, five days, two teams. Phones and tablets are buzzers. A laptop runs the game. A TV can show the board.

This document is the plan to generate the application.

## Decisions

| Topic | Choice | Why |
|---|---|---|
| App shape | One TypeScript app: React UI + Node API | One language for the UI, server, and tests |
| Realtime | Socket.io | Phones need a live buzz and a board that updates together |
| Data | SQLite on a Docker volume | Enough for 15 people, and questions survive deploys |
| Teams | Exactly two | Face-off and steal only make sense with two teams |
| Who controls the board | Host, on a laptop | Phones are buzzers, not the game-show board |
| Public URL | Domain + HTTPS | Phones on the house Wi-Fi open a normal website |
| Certificates | Caddy with Let's Encrypt | A purchased certificate is unnecessary; Caddy can still use one if already bought |
| Fast Money | Later, not in the first build | The main game is enough for the visit |

Put the droplet in a region close to the house so buzz latency stays low. Everyone on the same Wi-Fi will have similar latency. The server decides the winner by arrival time.

## Product

One private website. The host controls the game from a laptop. Everyone else joins from a phone, tablet, or another laptop. A TV or projector can show a display-only board.

The question bank, teams, and current game live in the database. They survive a restart and a deploy. They are not stored only in memory and not in source code.

### Roles

- **Host.** Password-protected. Creates teams, assigns people, opens and closes buzzers, enters or confirms answers, awards points, and manages questions.
- **Player.** Joins with a room code and a name. Sees their team, buzzes when the round allows it, and can type a guess when it is their turn.
- **Display.** Same board as the host, with no controls, for a TV.

There is one game at a time. There are no accounts beyond a host password and a player token stored in the browser.

### Join safety

The site is on the public internet. A short room code (set in the environment, changeable by the host) is required to register. The host password is separate and unlocks the host and admin screens.

## Game rules

Classic two-team Family Feud, simplified for phones.

### Setup

1. People open the site, enter the room code and their name, and land in a lobby.
2. The host creates two teams (name and color) and assigns each person to one team.
3. The host picks a question from the bank. Each question has a prompt and up to 8 answers. Each answer has a point value, optional aliases, and a rank.

### Face-off

1. The host chooses one face-off player from each team and opens the buzzers.
2. Only those two phones can buzz. The first buzz the server receives wins. Everyone else sees who won.
3. That player, or the host, types an answer. The app suggests a match. The host accepts a board answer, or rejects it.
4. A hit gives that team the choice to **Play** or **Pass**.
5. A miss sends the chance to the other face-off player, with buzzers staying closed. They answer in text.
6. If both miss, the host can reopen buzzers for everyone still in the face-off until someone hits the board.

### Main play

1. The controlling team gives answers one at a time. The host decides whose phone may submit, or types it themselves.
2. A match reveals that row on the board and adds its points to the round pot.
3. A miss, or a repeat of an answer already on the board, is a strike. Three strikes end the turn.
4. The other team gets one steal guess from one player.
5. A correct steal awards the **whole pot**, including the stolen answer’s points, to the stealing team.
6. A wrong steal leaves the pot with the team that built it.
7. Round points are added to the team total. The question is marked used.

The host can undo the last reveal, strike, or score change.

### End of game

Scores accumulate until the host starts a new game. Starting a new game clears the live round and team scores. It does not delete people, teams, or the question bank. A “points to win” value is optional; leave it empty to play until the host stops.

### Answer matching

Normalize before compare: trim, lowercase, ignore punctuation, and collapse spaces. Also check aliases (“sofa” matches “couch” if that alias is stored). Then suggest a close match using a short edit distance, but never auto-award on a fuzzy guess. The host always confirms. The host can also force an answer onto a specific board row when the wording is right and the matcher is wrong.

## Screens

Mobile first for players. The host board is built for a laptop in landscape.

1. **Join.** Room code, name, join button. Returning browsers reconnect with the saved token.
2. **Lobby.** Player name, team once assigned, and a waiting state.
3. **Player round.** Team color, a very large buzz button, disabled with a clear reason when it is not that player’s turn (“face-off”, “your team is playing”, “buzzer closed”). A text field appears only when that player is allowed to answer.
4. **Host control.** Lobby assignment, question picker, buzzer open/close, Play/Pass, strike, steal, score, undo.
5. **Board.** Game-show layout: two scores, the question, hidden answer rows that flip open, three strike marks, round pot. This is the TV view and the main part of the host screen.
6. **Question admin.** Create, edit, reorder, and delete questions and answers. Search. Filter used vs unused. Available any time. Does not require a restart.

Visual direction: dark blue board, high-contrast flip cards, large type, team colors on the scores, one obvious action on a phone. Touch targets should be easy to hit one-handed. A short buzz tone and a strike tone are part of the first version.

## Technical design

```text
phones / laptop / TV
        │  HTTPS
        ▼
      Caddy          TLS, reverse proxy
        │
        ▼
   Node server       HTTP API + Socket.io
        │
        ▼
   SQLite file       Docker volume ./data
```

### Repository layout

```text
apps/web        React + Vite + Tailwind
apps/server     Node + Fastify + Socket.io + Drizzle
packages/shared Round state, events, answer matching
data/           SQLite file on the droplet only, never in git
e2e/            Playwright
```

The React app is static files served by the Node server. The droplet runs one app container plus Caddy.

### Live state

The server is the authority. Browsers render what the server sends. A refresh, a new phone, or the TV display all receive the same snapshot: teams, scores, question, revealed rows, strikes, whose turn, buzzer open or closed, and the last buzz winner.

Buzz resolution:

- The host action `buzzer:open` records a window id.
- A phone sends `buzz` with that window id and its player token.
- The server ignores buzzes from the wrong person, a closed window, or a second press.
- The winner is the first event **received** by the server. Client clocks are not used.
- The server broadcasts the winner and closes the window.

### Data that must survive a deploy

| Stored | Cleared by “new game” | Cleared by deploy |
|---|---|---|
| Questions, answers, aliases | No | No |
| Players, teams, assignment | No | No |
| Scores and current round | Yes | No |

Tables: `players`, `teams`, `questions`, `answers`, `aliases`, `games`, `rounds`, `round_reveals`, `buzzes`. Store the live round as rows, not only in memory, so a process restart mid-question restores the board.

### Host and player sessions

- Host password compared to an environment variable. Session cookie, `httpOnly`, `secure`.
- Player: room code checked once, then a random token in `localStorage`. The server stores only a hash of the token.
- Names must be unique in the current visit. The host can remove a player or rename them.

## Testing

**Unit (Vitest).** Answer normalization, alias match, fuzzy suggestion, strike count, pot math, steal award, “first received buzz wins”, and ignoring late or ineligible buzzes.

**Integration (Vitest + the real server + a temporary SQLite file).** Create a question, join two players, assign teams, open buzzers, post two near-simultaneous buzzes, confirm only one winner, accept an answer, add a strike, steal, and assert the stored score. Restart the app process in a test and assert the round is still there. Admin edits do not require a restart and are still present after a new process opens the same database file.

**End to end (Playwright).** Three browser contexts: host, player A, player B. Join, assign teams, add a question through the admin UI, run a face-off, reveal an answer on the board, score a round. A fourth context opens the display route and sees the same reveal. Run this in GitHub Actions on every push and pull request.

## GitHub Actions and the droplet

**On pull request and on push:** install, unit tests, integration tests, Playwright.

**On push to `main`, only if tests passed:** SSH to the droplet, update the app, rebuild the image, and run `docker compose up -d`. The compose file mounts `./data` from outside the image. Deploy does not delete that directory. Database migrations run on startup and are additive.

Secrets: SSH key, droplet host, host password, room code. The SQLite file and `.env` stay on the server only.

Caddy listens on 80 and 443, obtains a Let's Encrypt certificate for the domain, and proxies to the app container. An A record points the domain at the droplet. The firewall allows 22, 80, and 443.

Before the visit, deploy once, add questions in the admin UI, join from a phone on the same Wi-Fi, and run one practice round.

## Build order

1. Repo, Docker Compose, Caddy, SQLite, and a health check.
2. Join flow, host login, teams, and lobby.
3. Question admin with persistence across a container restart.
4. Round state machine, board UI, answer matching, strikes, steal, and score.
5. Socket.io buzzers and the player phone screen.
6. Display route, undo, and used-question filter.
7. Unit, integration, and Playwright tests, then the GitHub Actions test and deploy workflows.

## Out of scope

More than two teams, user accounts, Fast Money, soundtracks, animated audience, native apps, and multi-game tenancy.

Fast Money can be a later round type: two players, a timer, five personal questions, then a family total compared with the other team.
