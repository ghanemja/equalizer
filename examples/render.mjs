// Render a song to a WAV file from the command line.
// Usage: node examples/render.mjs <song-id | path/to/song.js> [out.wav]
// A song module default-exports a song object: { bpm, bars, tracks: [...] }.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { renderSong, toWav } from '../src/equalizer.js';
import { SONGS } from '../src/presets.js';

const [arg = 'house', out = `${arg.replace(/\W+/g, '-')}.wav`] = process.argv.slice(2);
const song = SONGS[arg] ?? (await import(pathToFileURL(resolve(arg)).href)).default;
const t0 = performance.now();
const { left, right, sampleRate, duration } = renderSong(song, { sampleRate: 44100 });
writeFileSync(out, toWav(left, right, sampleRate));
console.log(`${out}: ${duration.toFixed(2)}s rendered in ${Math.round(performance.now() - t0)}ms`);
