// The commentary booth: two commentators, like a real broadcast.
//   Ray Marbles   (speaker 0) calls the action: overtakes, power-ups, the finish.
//   Dusty Rollins (speaker 1) adds colour: reactions, banter, the drink stakes.
// Race events become lines; each line has an energy level that speeds up and
// lifts the delivery. Lines are queued by priority and dropped when stale, so
// the booth keeps up with the race instead of reading old news.
// Optionally a local AI model writes Dusty's colour lines in quiet moments.
import { POWERS } from '../powers.js';
import { BrowserEngine, KokoroEngine, ServerEngine, stopAudio } from './voices.js';

export const BOOTH = ['Ray Marbles', 'Dusty Rollins'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const fill = (t, vars) => t.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
export const NTH = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const words = (n) => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'][n] ?? String(n);

// Each kind: { s: default speaker, e: energy 0..1, v: variants }.
// A variant is a line, or a list of [speaker, line] for a little exchange.
const LINES = {
  welcome: { s: 0, e: 0.55, v: [
    [[0, 'Good evening, and welcome to {track}! Ray Marbles here, alongside Dusty Rollins.'], [1, '{n} marbles on the grid tonight, Ray, and somebody is going home thirsty.']],
    [[0, "It's race night at {track}! {n} marbles, one winner."], [1, 'And remember folks: last place drinks.']],
    [[0, 'Welcome back to {track}, where the sand is fast and the drinks are flowing.'], [1, '{n} marbles lined up, Ray. I can smell the fear.']],
  ] },
  welcomeTally: { s: 1, e: 0.45, v: [
    '{tallyLeader} tops the table on {tallyPts} points. Everyone wants a piece of that.',
    '{thirsty} has had {thirstyDrinks} drinks already. Steady on, {thirsty}.',
    'Race number {raceNo} tonight. {tallyLeader} the one to beat.',
  ] },
  grid: { s: 0, e: 0.6, v: ['Marbles on the line…', 'Here we go. Gates are about to drop.', 'Deep breaths, everyone.'] },
  go: { s: 0, e: 1, v: ["And they're away!", "Gates are up, and they're off!", 'Go, go, go!'] },
  lead: { s: 0, e: 0.85, v: ['{a} takes the lead!', '{a} hits the front!', 'And through goes {a} into the lead!', '{a} goes past {b}. New leader!'] },
  leadHuman: { s: 0, e: 0.95, v: ['{a} snatches the lead off {b}! That is personal!', "{a} mugs {b} for the lead! There'll be words about that later.", 'Oh, {a} goes straight past {b}! Cheeky!'] },
  last: { s: 1, e: 0.6, v: ['{a} slips to the back. That is drinking territory.', "Uh oh. {a}'s propping up the field.", '{a} is last, and somebody better pour that drink.', "That's {a} at the back. I can hear the glass filling."] },
  escape: { s: 1, e: 0.7, v: ["{b} escapes last place! And it's {a} on the hook now.", "Ha! {b} wriggles free, and {a} drops to the back. Cruel game, Ray."] },
  jump: { s: 0, e: 0.75, v: ['{a} catches big air!', 'Up and over goes {a}!', 'Look at {a} fly!', 'Airborne! {a} takes flight!'] },
  clash: { s: 0, e: 0.7, v: ['Big contact between {a} and {b}!', '{a} and {b} trading paint!', 'Ooh, {a} clatters into {b}!'] },
  boost: { s: 0, e: 0.7, v: ['{a} hits the boost!', 'Boost from {a}!', '{a} puts the foot down!'] },
  section: { s: 0, e: 0.55, v: ['{a} leads them into {label}.', 'Into {label} now, {a} showing the way.', '{label} coming up, {a} out in front.'] },
  pickup: { s: 1, e: 0.55, v: ['{a} grabs a vape. Ooh, it is a {power}!', 'Puff of smoke, and {a} is holding a {power}.', 'A {power} for {a}. Now that could get spicy.'] },
  blocked: { s: 0, e: 0.85, v: ["But {a}'s shield takes it!", 'Blocked! {a} had the shield up!', "Bounces right off {a}'s shield!"] },
  toGo: { s: 0, e: 0.75, v: ['{dist} metres to go, and it is {lead} in front!', '{dist} metres left! Can anyone catch {lead}?', '{dist} metres to go. {lead} still leading!'] },
  homeStraight: { s: 0, e: 0.9, v: ['{lead} into the home straight!', 'Here comes {lead} down the home straight!', 'The finish line is in sight for {lead}!'] },
  win: { s: 0, e: 1, v: ['{a} wins it!', '{a} takes the chequered flag!', 'And {a} is your winner!', '{a} wins at {track}!'] },
  winBig: { s: 0, e: 1, v: ['{a} wins it by a mile!', 'Total domination! {a} wins by {margin} seconds!'] },
  photo: { s: 0, e: 1, v: ['Photo finish! {a} just edges {b}!', 'By a whisker! {a} pips {b} on the line!', "Oh, you couldn't split them! {a} gets it from {b}!"] },
  podium: { s: 0, e: 0.6, v: ['{a} comes home {nth}.', '{a} takes {nth}.', '{nth} place goes to {a}.'] },
  lastHome: { s: 1, e: 0.7, v: ['And {a} brings up the rear. Drink up, {a}!', 'Last across the line is {a}. You know what that means.', '{a} finishes last. Bottoms up!', "Oh dear, {a}. That's a drink."] },
  damage: { s: 1, e: 0.55, v: ['Right, the damage: {list}.', 'So, the bill please: {list}.'] },
  filler: { s: 1, e: 0.35, v: [
    '{lead} leads by {gap} metres. Looking very comfortable.',
    '{lead} out in front, {second} hunting them down.',
    "{last}'s at the back, Ray. Get the glass ready.",
    '{gap} metres between {lead} and {second}. Not over yet.',
    "This track's been tough tonight. The sand is really slowing them down.",
    "I'll tell you what, Ray, {second} is looking hungry.",
  ] },
  holding: { s: 1, e: 0.45, v: ["{a}'s sitting on a {power}. Who's it going to be?", "{a} still holding that {power}. Patience or panic?", 'Keep an eye on {a}. That {power} is burning a hole in their pocket.'] },
  portal: { s: 0, e: 0.85, v: ['{a} takes the portal shortcut!', 'Whoosh! {a} vanishes and pops out down the track!', 'Through the portal goes {a}! Is that even legal?'] },
  tramp: { s: 0, e: 0.75, v: ['Boing! {a} bounces sky high!', '{a} hits the bounce pad!', 'Up goes {a} off the trampoline!'] },
  bumper: { s: 1, e: 0.55, v: ["{a}'s pinging off the bumpers like a pinball!", 'Ding ding ding! {a} in the bumpers!'] },
  world_moon: { s: 1, e: 0.5, v: ['Low gravity tonight, Ray. These jumps are going to be enormous.', 'One small roll for a marble, Ray.'] },
  world_castle: { s: 1, e: 0.5, v: ["Lovely spot for it, Ray. Just don't fall in the moat.", 'A royal occasion. Crowns at the ready.'] },
  world_candy: { s: 1, e: 0.5, v: ["Careful out there, Ray. It's sticky.", "I've got a sugar rush just looking at it."] },
  world_neon: { s: 1, e: 0.5, v: ['Bright lights, big city, Ray.', 'Hyperlanes are open. This could get fast.'] },
  world_meadow: { s: 1, e: 0.45, v: ['Beautiful evening for it, Ray.'] },
  world_desert: { s: 1, e: 0.45, v: ['Hot out there, Ray. Sand everywhere.'] },
  world_snow: { s: 1, e: 0.45, v: ["Cold one tonight, Ray. Watch that ice."] },
  world_lava: { s: 1, e: 0.45, v: ["It's toasty, Ray. Nobody wants to drop in the lava."] },
  comeback: { s: 1, e: 0.8, v: ['What a comeback from {a}! Up to {pos} now!', '{a} has come from nowhere! {pos} and climbing!'] },
};

// colour commentator reactions after big moments (sometimes)
const REACT = {
  lead: ['Oh, lovely move.', 'Did not see that coming.', 'Textbook.'],
  leadHuman: ['Friendships are being tested tonight.', "That's going to sting.", 'Oh, that is spicy.'],
  power: ['Oh, that is nasty.', 'Ruthless!', 'No mercy tonight.', 'I love it.'],
  clash: ['That one will leave a mark.', 'Ouch.'],
  jump: ['Beautiful.', 'Ten out of ten.'],
  win: ['What a race!', 'Get in!', 'Magnificent marble.'],
};

const POWER_LINES = {
  turbo: ['{a} fires the turbo!', 'Turbo from {a}! Look at it go!'],
  ghost: ['{a} goes ghost!', 'Spooky! {a} turns into a ghost!'],
  magnet: ['{a} locks on with the magnet!', 'Magnet from {a}, being dragged up the field!'],
  shield: ['{a} shields up.', 'Shield on for {a}. Smart.'],
  sandbomb: ['{a} drops a sand bomb!', 'Sand bomb from {a}! Watch out behind!'],
  bonk: ['{a} bonks {t} into the wall!', 'Bonk! {a} sends {t} flying!'],
  freeze: ['{a} freezes {t}! Ice cold!', 'Brr! {a} freezes the leader, {t}!'],
  swap: ['{a} swaps places with {t}! Daylight robbery!', 'Teleport! {a} and {t} swap places!'],
  scramble: ["{a} scrambles everyone's steering!", 'Steer scramble from {a}! Left is right, right is left!'],
  earthquake: ['Earthquake from {a}! Everyone is bouncing!', '{a} shakes the whole track!'],
};

export class Commentator {
  constructor({ onCaption, onStatus } = {}) {
    this.enabled = true;
    this.engineKind = 'browser';
    this.voiceNames = ['', ''];
    this.ai = false;
    this.queue = [];
    this.current = null;
    this.onCaption = onCaption || (() => {});
    this.onStatus = onStatus || (() => {});
    this.engines = { browser: new BrowserEngine() };
    this.lastSaid = 0;
    this.recent = new Map();
    this.aiBusy = false;
  }

  // ---------------- voices ----------------
  setEngine(kind) {
    this.engineKind = kind;
    if (kind === 'kokoro' && !this.engines.kokoro) { this.engines.kokoro = new KokoroEngine(this.onStatus); this.engines.kokoro.load().catch(() => {}); }
    if (kind === 'server' && !this.engines.server) this.engines.server = new ServerEngine(this.onStatus);
  }
  engine() { return this.engines[this.engineKind] || this.engines.browser; }
  browserVoices() { return this.engines.browser.voices(); }

  // ---------------- queue ----------------
  say(text, prio = 1, ttl = 4, { speaker = 0, energy = 0.5 } = {}) {
    if (!this.enabled || !text) return;
    text = text.charAt(0).toUpperCase() + text.slice(1);
    const now = performance.now();
    this.queue.push({ text, prio, until: now + ttl * 1000, speaker, energy });
    if (this.current && prio >= 3 && this.current.prio < 3) this.interrupt();
    this.pump();
  }

  // a scripted exchange plays in order, as one block
  exchange(lines, prio, ttl, energy) {
    lines.forEach(([speaker, text], i) => this.say(text, prio - i * 0.01, ttl + i * 4, { speaker, energy }));
  }

  line(kind, vars = {}, prio = 1, ttl = 4) {
    const L = LINES[kind]; if (!L) return false;
    // some calls are rationed per marble, chatty ones across the whole race
    const k = ['section', 'clash', 'jump', 'boost', 'filler', 'tramp', 'bumper'].includes(kind) ? kind : kind + (vars.a || '');
    const last = this.recent.get(k) || 0, now = performance.now();
    const gap = { lead: 3, leadHuman: 3, last: 7, escape: 6, jump: 8, boost: 5, clash: 8, section: 12, pickup: 6, holding: 20, toGo: 0, filler: 0, tramp: 8, bumper: 12, portal: 3 }[kind] ?? 0;
    if (now - last < gap * 1000) return false;
    this.recent.set(k, now);
    const v = pick(L.v);
    if (Array.isArray(v)) this.exchange(v.map(([sp, t]) => [sp, fill(t, vars)]), prio, ttl, L.e);
    else this.say(fill(v, vars), prio, ttl, { speaker: L.s, energy: L.e });
    if (REACT[kind] && Math.random() < 0.35) this.say(pick(REACT[kind]), prio - 0.05, ttl + 2, { speaker: 1, energy: L.e * 0.8 });
    return true;
  }

  power(key, vars, prio = 1.6) {
    const tmpl = vars.miss ? `{a} uses ${POWERS[key].name}… and misses!` : pick(POWER_LINES[key] || ['{a} uses a power-up!']);
    this.say(fill(tmpl, vars), prio, 3.5, { speaker: 0, energy: 0.85 });
    if (!vars.miss && vars.t && Math.random() < 0.3) this.say(pick(REACT.power), prio - 0.05, 5, { speaker: 1, energy: 0.7 });
  }

  async pump() {
    if (!this.enabled || this.current) return;
    const now = performance.now();
    this.queue = this.queue.filter((q) => q.until > now);
    if (!this.queue.length) return;
    this.queue.sort((a, b) => b.prio - a.prio);
    const item = this.queue.shift();
    this.current = item;
    this.lastSaid = now;
    this.onCaption(item.text, BOOTH[item.speaker]);
    const eng = this.engine();
    const voice = this.voiceNames[item.speaker] || '';
    try {
      await Promise.race([
        eng.speak(item.text, { voice, speaker: item.speaker, energy: item.energy }),
        new Promise((r) => setTimeout(r, 2500 + item.text.length * 120)),
      ]);
    } catch (e) {
      // a natural voice failed: say it with the built-in voice instead
      if (eng !== this.engines.browser) { this.onStatus(`Voice error (${e.message || e}); using browser voice for now.`); await this.engines.browser.speak(item.text, { speaker: item.speaker, energy: item.energy }); }
    }
    if (this.current === item) { this.current = null; this.lastSaid = performance.now(); setTimeout(() => this.pump(), 120); }
  }

  interrupt() { this.engine().stop(); stopAudio(); this.current = null; }
  quietFor() { return this.current ? 0 : (performance.now() - this.lastSaid) / 1000; }
  stop() { this.queue = []; this.interrupt(); this.onCaption(''); }

  // ---------------- local AI colour commentary ----------------
  async aiLine(task, facts, prio = 0.5, ttl = 6) {
    if (!this.ai || this.aiBusy || !this.enabled) return false;
    this.aiBusy = true;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 6000);
      const res = await fetch('api/llm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
        body: JSON.stringify({
          model: this.aiModel || undefined,
          messages: [
            { role: 'system', content: `You are ${BOOTH[1]}, the colour commentator for a marble race shown at a house party, working alongside play-by-play caller ${BOOTH[0]}. Style: a cheeky British sports commentator, like the voice of Jelle's Marble Runs crossed with a darts commentator. Playful banter about the marbles and the drinking-game stakes (last place drinks), never mean about real people, nothing crude. Reply with ONE spoken sentence of at most 20 words. No emojis, no hashtags, no stage directions, no quotation marks.` },
            { role: 'user', content: `${task}\nFacts: ${JSON.stringify(facts)}` },
          ],
        }),
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`AI said ${res.status}`);
      const data = await res.json();
      let text = (data.text || '').replace(/["“”*#]/g, '').replace(/\s+/g, ' ').trim();
      const first = text.match(/^.*?[.!?](\s|$)/); if (first && first[0].length > 12) text = first[0].trim();
      if (!text || text.length > 180) return false;
      this.say(text, prio, ttl, { speaker: 1, energy: 0.5 });
      return true;
    } catch (e) {
      return false;
    } finally { this.aiBusy = false; }
  }
}

export { words };
