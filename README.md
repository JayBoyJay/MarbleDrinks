# Marble Mayhem

A party marble-racing game inspired by Jelle's Marble Runs. The race plays on a TV or laptop in the browser (three.js). Everyone joins with their phone by scanning a QR code, and the phone becomes their remote.

## Play it online (GitHub Pages, free)

The game is a plain website, so GitHub Pages hosts it for free. Open the site on the computer connected to the TV, and everyone scans the QR code. Phones can be on Wi-Fi or mobile data, and anyone can also open `…/play.html` and type the 4-letter game code shown under the QR.

Phones connect straight to the race screen over the internet. PeerJS's free connection service only introduces them; after that, everything goes device-to-device. Tilt steering works straight away, because GitHub Pages is a secure (https) site.

To set it up on your own GitHub: push this folder to a repository, then go to **Settings → Pages**, set **Source** to *Deploy from a branch*, pick `main` and `/ (root)`, and save. A minute later the game is live at `https://<your-username>.github.io/<repo-name>/`.

## Play without internet (optional)

Run it from your own computer on your Wi-Fi instead. You need [Node.js](https://nodejs.org) 18 or newer, and nothing else to install.

- **Windows:** double-click `start.bat`
- **Anywhere:** `npm start` (or `node server/server.js`)

Then open **http://localhost:3000** on the computer connected to the TV and scan the QR with phones on the **same Wi-Fi**. The local version also unlocks the commentary booth's **Server** voice and **AI banter** options (see below).

If the phones can't connect:
- Allow Node through your computer's firewall the first time it asks (on Windows, tick "Private networks").
- If the computer has more than one network adapter, the terminal lists the other addresses. Start the server with the right one, for example `HOST_IP=192.168.1.20 npm start` (on Windows PowerShell: `$env:HOST_IP="192.168.1.20"; npm start`).
- Use a different port with `PORT=8080 npm start`.
- **Tilt steering** on the local version needs a secure link. The server makes one with `openssl` if it's installed (on port 3443; phones show a one-time "not private" warning to tap through). Without `openssl` (common on Windows), use the online version for tilt.

**Testing the online way locally:** open `http://<this computer's Wi-Fi address>:3000/?online` and the race screen uses peer-to-peer connections (with a game code), exactly like GitHub Pages, while still being served from your computer.

## How a round works

1. **Lobby:** players join, pick a marble skin (24 to choose from, one per player) and tap **I'm ready**. The race starts automatically when everyone is ready. You can also press **Start race** on the big screen.
2. **Countdown, then race:** the camera cuts between leader cam, the pack, trackside shots and the *fight for last place*. Phones show your live position and a **BOOST** button: 3 boosts per race, with a cooldown. You can turn boosts off in the lobby.
3. **Results and the damage**, among phone players only (CPU marbles race but never drink):
   - 🥇 Winner picks someone to take a **drink**. If a CPU marble wins, the best human picks.
   - 🥈 Second picks someone to take a **sip**.
   - 🐌 Last takes a **drink**.
   - 🐢 Second last takes a **sip**.

   Picks are made on the winner's phone. The big screen also has buttons in case a phone is asleep, and a random pick happens after 45 seconds.
4. **Tally:** points (25/18/15/12/10…), wins, and drinks and sips taken are kept across races, even if the page reloads. Use **Reset tally** to start a new night.

With 2 players, there's no sip round (the winner picks, and last drinks). The sip round needs 3 or more.

## Photo marbles

In the lobby, the first tile in **Pick your marble** is **📷 Your photo**. Take a selfie or choose any image from the phone, drag and zoom to line it up, then pick a style:
- **😀 Face on the front:** the circle you line up goes on the front of the marble, and the rest takes on the colour around the edge of the photo.
- **🌐 Wrap around:** the image wraps right around the marble. This suits patterns, logos and pets.

The phone shows a live preview of the marble before you confirm. The picture is cropped to a small square on the phone and only sent to the race screen. The race screen remembers it, so **Use my last photo again** brings it back after you've tried other skins. Removing a player from the lobby removes their photo too.

## Seeing your marble

**TV camera: Per player** (the default) splits the screen into one view per phone player, each following that player's marble with a glowing arrow over it in their colour. Each view is labelled with the player's place and name, and the last-placed person gets a 🍺. Two players sit side by side, 3–4 get a 2×2, 9 get a 3×3 and 16 get a 4×4. Any spare spot in the grid follows the leader. With more than 4 players, the standings, timer and pause button move into a sidebar so they don't cover anyone's view. Up to 24 marbles race at once (for example 16 phones plus 8 CPU marbles); there's no hard limit on phones, but skins start repeating after 24 players.

**All marbles** keeps every marble on screen instead. While the field is close together it's one view, and as it spreads out the screen splits into up to four panes, each following a group. **Broadcast** is the cinematic camera, cutting between leader cam, the pack, trackside and the fight for last.

With lots of players, the laptop draws the race many times per frame. A decent graphics card handles 16 views fine; if it stutters, the game lowers its quality automatically, or switch to **All marbles**.

Each phone also gets a **live track radar**: a top-down map of the track around your marble, with the way ahead pointing up. It shows walls, the split, slow and fast patches, pegs, moving sweepers, jumps, vapes you can grab, dropped sand bombs, and every rival by name. A tag shows what's next ("Next: The Split in 34 m"). The phone builds its own copy of the track from the race's seed, so only marble positions are sent over Wi-Fi, about ten times a second.

## Pausing and menus

- **Pause:** during a race, click **⏸ Pause** on the race screen (or press Esc, P or Space). The race freezes and phones show "Paused".
  - **Resume:** carries on where you left off.
  - **Restart race:** starts the same track again from the grid.
  - **Exit to main menu:** abandons the race and goes back to the lobby. Abandoned and restarted races don't count on the tally.
- **After a race:** **Race again** starts the next race straight away on a fresh track. **🏠 Main menu** goes back to the lobby to change settings, worlds or players. If someone is still choosing who drinks when you leave, a random pick is made so the tally stays complete.

## Commentary booth

Two commentators call every race: **Ray Marbles** on play-by-play (overtakes, power-ups, distance calls, the finish) and **Dusty Rollins** on colour (reactions, banter, who's in drinking territory). They know about rivalries between players, comebacks from last, photo finishes, the tally ("Priya has had four drinks already"), and they read out the damage at the end. Bigger moments are delivered faster and more excitedly, and every line shows as a subtitle on the TV. Set it all up in the **🎙️ Commentary booth** card in the lobby, and use **Test the booth** to hear it.

### Voices (pick one in the lobby)

| Option | Sounds | Setup |
|---|---|---|
| **Built-in** | Robotic-ish | None. Uses the computer's own voices, offline. |
| **Kokoro** | Natural | None. Kokoro-82M runs inside the race screen's browser. It needs internet the first time to download the voice model (cached afterwards). Fastest in Chrome or Edge with a decent graphics card. |
| **Server** | Natural, fastest | Local version only. Run a local voice server (below). Best if the laptop is slow, or you want it fully offline after setup. |

The **Server** option works with Kokoro-FastAPI (install Docker, then run one command):
```
docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest
```
(For an NVIDIA graphics card, use `--gpus all` and `ghcr.io/remsky/kokoro-fastapi-gpu:latest`.) Any other server with an OpenAI-style `/v1/audio/speech` endpoint works too. Point the game at it with `TTS_URL=http://host:port/v1/audio/speech npm start`.

Kokoro voices to try: *George* or *Fable* (British) for Ray, *Michael* or *Adam* (American) for Dusty.

### AI banter (optional, local version only)

With a local AI model running, Dusty writes fresh colour commentary from the live race (positions, gaps, who's holding what, the tally) in quiet moments, plus a one-line roast after each race. The scripted calls still handle the fast action, because they're instant.

- **Ollama:** install it, then run `ollama pull llama3.2` (or `gemma3:4b`). The game finds it on port 11434.
- **LM Studio:** load a small model and start its server, then run the game with `LLM_URL=http://localhost:1234/v1/chat/completions npm start`.

Both of these run through the local server (`start.bat`), because a website on GitHub Pages can't talk to programs on your computer. Turn **AI banter** on in the lobby and pick the model. If the AI is slow or not running, the booth falls back to the scripted lines.

## Hats

Pick a hat on your phone in the lobby: top hat, party hat, crown, cowboy, viking, propeller cap, wizard, chef, halo, traffic cone, Santa, sombrero or bunny ears. Hats float just above your marble and stay upright while it rolls. Propellers spin, halos bob, and CPU marbles sometimes wear one too.

## Power-ups

Glowing vapes hover across the track every 60 m or so. Roll through one and it disappears in a puff of smoke, giving you a random power-up on your phone. Tap the power-up card to use it, which sends out another puff. You can only hold one: rolling through another vape replaces it. Vapes come back a couple of seconds after they're taken.

| Power-up | What it does |
|---|---|
| 🚀 Turbo | Huge burst of speed |
| 👻 Ghost | Pass through marbles and pegs for 3 seconds |
| 🧲 Magnet | Get dragged toward the marble ahead |
| 🛡️ Shield | Blocks the next attack and ignores slow patches |
| 💣 Sand Bomb | Dumps a slow patch on the track behind you |
| 🥊 Bonk | Knocks the marble ahead into the wall |
| 🧊 Freeze | Freezes the race leader for 2 seconds |
| 🔄 Swap | Trade places with a random marble ahead |
| 🌀 Steer Scramble | Flips everyone else's tilt steering for 5 seconds (tilt mode only) |
| 🌋 Earthquake | Shakes up every other marble |

The draw depends on race position: marbles near the back are more likely to get Swap, Freeze and Turbo, and leaders get more Shields and Sand Bombs. CPU marbles grab and use power-ups too. Turn power-ups off in the lobby for a pure race.

## Tilt steering

Turn on **Tilt steering** in the lobby and players steer their marble left and right by tilting their phone like a tray. The phone's angle when the countdown starts counts as straight, and a **Re-centre** button resets it. Phones without a motion sensor can drag a slider instead.

Phone browsers only share motion sensors with secure (https) pages. **Online (GitHub Pages) that's automatic**: iPhones just ask to allow motion access when you tap **Enable tilt**.

On the **local version**, the QR code switches to a secure link (port 3443) in tilt mode. The first time, each phone shows a "connection isn't private" warning, because the certificate is self-signed. That's expected on your own Wi-Fi:
- **Android / Chrome:** tap *Advanced*, then *Proceed*.
- **iPhone / Safari:** tap *Show details*, then *visit this website*.

Phones that joined on the plain link get a **Switch to secure link** button and keep their player. The server makes its certificate with `openssl` the first time (saved in `server/certs/`, which is never uploaded to GitHub). If `openssl` isn't installed, play tilt mode online instead.


## Tracks

Tracks are channels dug into a hillside, like the sand rally videos. The channel is a curved U shape: marbles ride up the walls in corners and roll back down. Every race gets a freshly generated course built from modules, and it never crosses itself:

| Module | What it does |
|---|---|
| The Split | Track widens and splits around a divider. One lane is rough (humps or pegs), the other has a slow patch then a speed strip. |
| Rickety Bridge | Narrow plank bridge over a ravine, with rope rails (the only part not dug into the ground). |
| Peg Forest | Pachinko-style pegs that deflect marbles. |
| Big Air | Speed strip into a ramp and a gap jump. |
| Sweeper Alley | Hazard blocks sliding across the track. |
| Speed Humps | Bumps that slow and bounce marbles. |
| Trap | A slow surface patch (mud, sand, snowdrift or ash, depending on terrain). |
| Chute / The Plunge | Steep fast sections. |
| Rolling Waves | A run of dips and rises; marbles slow on every climb. |
| Pinball Alley | Springy bumpers that kick marbles sideways. |
| The Windmill | Big spinning bars across the channel; time it or get swatted. |
| Portal Shortcut | One side of the channel has a portal (behind a slow patch) that pops marbles out 24 m further on. |
| Bounce Pads | Trampolines that launch marbles over a row of stakes (huge on the Moon). |
| Hairpin, Chicane, Spiral, Slalom, Sweeping Bend | Curved corners between features. |

### Worlds

| World | What's different |
|---|---|
| 🌳 Meadow Run | Grassy hills, mud pits, a lake |
| 🌵 Desert Canyon | Sand traps, cacti, canyons |
| ❄️ Frozen Peaks | Slippery ice, faster and more sliding about |
| 🌋 Volcano Dash | Ash bogs, a glowing lava lake |
| 🌙 Moon Base | **Low gravity**: jumps and bounce pads send marbles floating. Craters, domed moon bases, Earth in the sky |
| 🏰 Castle Siege | Castles with turrets and flags, a moat, the royal carpet |
| 🍭 Candy Land | Lollipops, candy canes, gumdrops, donuts and a syrup swamp |
| 🌃 Neon City | Glowing grid ground, neon-lit channel edges, skyscrapers and a synthwave sun |

**Fans:** crowds of marble fans line the banks at the start, the finish and the big features. Some wear party hats, and they jump about and go wild as the racers roll past.

The lobby lets you pick a world (or 🎲 random), track length (short ≈ 45s, medium ≈ 60–80s, long ≈ 100s+) and the number of CPU marbles (0–8). The modules on each track are picked at random, and every track gets at least one of the wacky ones.


## Performance

The race screen picks a quality level automatically. If it runs slowly, open `http://localhost:3000/?quality=low`. Use `?quality=high` to stop it lowering quality.

## Files

```
index.html              race screen (lobby, HUD, results)
play.html               phone remote
js/net.js               phone connections: peer-to-peer (GitHub Pages) or the local server
js/qr.js                draws the join QR in the browser
js/skins.js             marble skins (shared by both screens)
js/hats.js, powers.js   hat list and power-ups (shared)
js/host/
  main.js               game flow, tally, drink rules, phone views
  track.js              modular track generator + worlds
  sim.js                marble physics
  render.js, extras.js  three.js scene: track, terrain, scenery, fans, features
  hats3d.js             3D hats
  camera.js             all-marbles split screen and broadcast camera
  commentator.js        the commentary booth
  voices.js             built-in, Kokoro and voice-server engines
vendor/                 three.js r170
server/server.js        optional local Wi-Fi server (also the voice/AI proxy)
server/lib/             bundled ws (WebSocket) and QR encoder, so no npm install is needed
start.bat               starts the local server on Windows
```

## Ideas for later

- More modules: funnels, elevators, water sections, elimination races.
- Sound effects for rolling and collisions.
- A more natural commentator voice from a local text-to-speech model (such as Piper or Kokoro), running beside the server.
- Voice commands with a speech-to-text model such as Phonon-2: shout "boost!" or "use it!" at your phone.
- Season mode with team marbles, like the Marble League.

## Credits

three.js (MIT), PeerJS (MIT, loaded from a CDN), ws (MIT), and the QR encoder from qrcode-terminal (Apache 2.0). Licences are in `vendor` and `server/lib`.
