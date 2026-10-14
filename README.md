# Word Search

Make a word search puzzle and share it as a link that's playable in the browser.

The whole puzzle lives in a short code in the URL fragment, so there's no backend:

```
https://example.com/#EwsmEgcJUG9uZCBMaWZlJUawQe4gDFDRBZAjUI1gYlmQGk84JFKSYEFk9wKBJB7CgkmEGFAA
```

The code is base64url of a few bytes: version and direction flags, grid size, a 24-bit random seed, the title (UTF-8), then the words packed as 5-bit letters (A–Z plus Ñ). The grid itself isn't stored. It's regenerated from the seed with a seeded PRNG, so a 10-word puzzle comes to about 70 characters and the words can't be read from the link.

Because links depend on the generator, **changing `generate()` would break existing links**. Bump `VERSION` in `js/puzzle.js` and keep the old code path for old links.

Players don't see the word bank until they choose to reveal it, and they get a confirmation prompt first.

## How the grid is built

`generate()` in `js/puzzle.js` uses **randomized greedy placement with restarts**:

1. Sort the words longest first, since long words are the hardest to fit.
2. For each word, try every allowed direction from every start cell. A placement is a candidate if it stays on the grid and each letter lands on an empty cell or matches the letter already there (a crossing).
3. Pick a random candidate. If any candidates cross another word, 40% of the time the pick comes only from those, so the words weave together.
4. If a word has no candidates, it's left out. If anything was left out, wipe the grid and try again (up to 25 attempts).
5. Fill the empty cells with random letters.

Every random number comes from a seeded PRNG (mulberry32), so the same seed always builds the same grid. That's what lets the share link store a seed instead of the grid.

### Algorithm visualizer

**Visualize the algorithm** on the create page (or `#watch/<code>`) replays these steps in real time. It shows the scan with a heatmap of the cells where a word can start, clashes, the candidates and the dice roll, letters being written, restarts and the random fill. It also highlights the matching pseudocode line and has play, step, skip and speed controls. It replays the real trace from `generate()`, so it always ends with the exact puzzle grid. On the play page it's offered only after the puzzle is solved or the answers are revealed, so it can't spoil anything.

## Run locally

It's plain HTML/CSS/JS with no build step. Serve the folder with any static server:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Deploy by uploading the folder to any static host (GitHub Pages, Cloudflare Pages, Netlify).

## Files

- `index.html`: the create form and the play view
- `style.css`: responsive layout and the duck theme (sunny day, starry night), shared with Ducktionary
- `js/puzzle.js`: seeded grid generation, word finding, share-code encoding and decoding (no DOM, works in Node)
- `js/ducks.js`: wandering ASCII ducks, starfield and the theme, duck and motion toggles (prefs use Ducktionary's localStorage keys)
- `js/app.js`: UI, drag or tap selection, timer, progress saved in localStorage
- `js/visualize.js`: the step-by-step algorithm visualizer
