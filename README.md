# Pokédex

A browser-based Pokédex application built with vanilla JavaScript (jQuery), HTML, and CSS. Fetches data from [PokeAPI v2](https://pokeapi.co/) and displays it in a Pokédex-device-inspired interface.

## Features

### List View
- Responsive card grid showing all 151 Kanto Pokémon (dex number, sprite, name, type badges)
- Scroll-aware batch loading — fetches data in small batches as you scroll
- Image lazy-loading via IntersectionObserver
- Type badges color-coded to match each of the 18 Pokémon types

### Filters
- **Text search** — filters by name or dex number as you type
- **Type filter** — multi-select chip buttons (OR logic), 18 types color-coded
- **Generation filter** — select Gen 1-9 (uses dex-number range lookup, no extra API calls)
- All three filters apply simultaneously with AND logic

### Detail View
- Large official artwork sprite
- Dex number, capitalized name, and type badges
- Flavor text description (fetched from `/pokemon-species/{id}`)
- **Evolution chain** with branching support:
  - Linear chains (e.g. Charmander → Charmeleon → Charizard)
  - Branching chains (e.g. Eevee → 8 different evolutions as siblings)
  - Evolution conditions shown on arrows (level, items, friendship, trade, time of day, etc.)
  - Currently-viewed Pokémon highlighted in gold
  - Sprite thumbnails for each evolution stage
- **Base stats** visualized as horizontal bars scaled to max 255 (color-coded per stat)

### Reliability
- Concurrency-limited API fetching (6 simultaneous requests max)
- 429 retry logic for API calls (retries once after 2s)
- Persistent image retry state machine — bounded retries (2 max), never infinite
- 429-aware image backoff (3s for rate-limit, 1.5s for other failures)
- Broken-image fallback to inline Pokéball SVG placeholder
- In-memory caching for all API responses — no redundant fetches

### Design
- Pokédex device aesthetic: red/dark chrome frame with indicator lights, dark screen area, speaker grill
- `Press Start 2P` pixel font for numbers and stats, `Roboto` for body text
- Fully responsive: 5-6 columns desktop → 2 columns mobile

## Tech Stack

- **jQuery 3.3.1** (CDN)
- **Vanilla CSS** (no frameworks)
- **Google Fonts**: Press Start 2P, Roboto
- **SweetAlert** for error notifications
- **PokeAPI v2** (REST endpoints)

## API Endpoints Used

| Endpoint | Purpose |
|---|---|
| `/pokedex/1` | Get list of all Kanto Pokémon (entry numbers + species URLs) |
| `/pokemon/{id}` | Per-Pokémon details: sprites, types, stats |
| `/pokemon-species/{id}` | Flavor text, evolution chain URL |
| Evolution chain URL (from species) | Full evolution tree with conditions |

## Project Structure

```
.
├── index.html              # Main HTML with filter bars, list/detail containers
├── css/
│   └── main.css            # All styles (532 lines)
├── js/
│   └── app.js              # All application logic (743 lines)
├── assets/
│   └── images/             # Static images (logo, favicon)
└── images/                 # Background images (legacy)
```

## Getting Started

No build step required. Open `index.html` in any modern browser:

```bash
open index.html
# or
start index.html   # Windows
```

All external dependencies are loaded via CDN (jQuery, Google Fonts, SweetAlert).

## Performance Notes

- Only the first 30 Pokémon are fetched on initial page load
- Subsequent batches of 30 are prefetched as you scroll toward the end of loaded data
- Images lazy-load via `IntersectionObserver` (200px margin) — only visible/near-visible cards request sprites
- All API responses are cached in memory; clicking Back or re-visiting a Pokémon uses cached data instantly