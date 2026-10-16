# equalizer

**Beats from math.** Every drum, bass line and melody is an equation you can read, tweak and share.

```
kick  = sin(TAU * (base*tau + punch*(1 - exp(-tau*sweep))/sweep)) * exp(-tau*decay)
pluck = (sin(TAU*f*tau) + bright*sin(TAU*2*f*tau)) * exp(-tau*decay)
hat   = noise() * exp(-tau*55)
```

![equalizer studio](docs/screenshot.png)

**Open the studio:** https://ghanemja.github.io/equalizer/

The studio looks like a DJ console, but every sound is just an equation. Each sound gets a row in the step grid: light up squares to make it play. Click a sound to open its panel, where the knobs are the numbers in its equation and you can edit the math itself. The math monitor on the right plots every sound's equation on graph paper, live: each time a sound fires, a playhead sweeps along its curve. At the top, the equation lab lets you paste any equation, hear it, see its plot, and add it to the beat in one click. Share any beat as a link.

No samples, no dependencies, no build step. Every sound is computed from math, 44,100 times a second.

## How it works

A song is a tempo plus a list of tracks. Each track is an equation, a step pattern that says when it fires, and its parameters:

```js
import { renderSong, toWav, Player } from 'equalizer';

const song = {
  bpm: 120,
  bars: 4,
  tracks: [
    {
      name: 'Kick',
      equation: 'sin(TAU * (base*tau + punch*(1 - exp(-tau*sweep))/sweep)) * exp(-tau*decay)',
      params: { base: 48, punch: 160, sweep: 28, decay: 7 },
      pattern: 'x...x...x...x...',
    },
    {
      name: 'Bass',
      equation: 'saw(f*tau) * exp(-tau*3)',
      pattern: 'C2 . . . C2 . Eb2 . F2 . . . G2 . . .',
      lp: 600,
    },
  ],
};

// In the browser: play it, and hot-swap changes without stopping
const player = new Player();
await player.play(song);       // after a click
player.update(changedSong);

// Anywhere, including Node: render to audio or a WAV file
const { left, right, sampleRate } = renderSong(song);
const wav = toWav(left, right, sampleRate);
```

### Variables

| Name | Meaning |
| --- | --- |
| `t` | seconds since the song started |
| `tau` | seconds since this note started (use it for envelopes) |
| `f` | the note's frequency in Hz |
| `beat`, `bar`, `step` | position in the song |
| `r` | a random number per note, for humanizing |
| `bpm` | the tempo |

Plus any parameters you define (`decay`, `punch`, …), which become knobs in the studio.

### Functions

`sin cos tan tanh exp log pow sqrt abs min max floor fract mod clamp mix`, oscillators that take a phase in cycles (`osc`, `saw`, `sqr(p, duty)`, `tri`), `noise()`, an envelope `ad(tau, attack, decay)`, and constants `PI TAU E`. `a ^ b` is a power and `cond ? a : b` picks between two values.

### Patterns

- Drums: `x...x...` (`x` fires, `.` lets it ring, `-` stops it, `|` is ignored so you can write `x...|x...`).
- Notes: `C3 . E3 . G3+B3 -` (notes, or chords joined with `+`).
- `rate` is steps per beat (4 = sixteenth notes, 0.25 = one per bar).
- `at: [1.5, 3.2]` fires at exact times in seconds, handy for sound effects.
- `gate: 't > 8 && bar < 12'` is an equation that decides whether a step fires. Use it for arrangement: drop the drums out, bring them back.

### Track options

`gain`, `pan` (−1 to 1), `lp` and `hp` (one-pole filters in Hz), `echo` (feedback 0–0.9) with `echoTime` in beats, `len` (max note length in seconds), `mute`, `solo`. Songs take `bpm`, `bars` or `duration`, `master`, `fadeIn` and `fadeOut`.

## Safe to share

Songs travel as links, so equations are never run as JavaScript. A small parser accepts only numbers, math operators and the whitelisted names above, and rejects everything else (`constructor`, property access, strings, assignments and so on). The test suite includes those attacks.

## Render from the command line

```sh
node examples/render.mjs house house.wav        # a built-in song
node examples/render.mjs ./my-song.js out.wav   # a module that default-exports a song
```

## Develop

```sh
npm test       # node's built-in test runner, no dependencies
npm start      # serve the studio at http://localhost:8080
```

`src/equalizer.js` is the library, `src/presets.js` holds the built-in equations and songs, and `index.html`, `studio.css` and `studio.js` are the studio.

## Made with equalizer

The soundtrack of the [art-medium](https://github.com/ghanemja/art-asset) promo video was written with equalizer: every note and sound effect is an equation.

## License

MIT. See [LICENSE](LICENSE).
