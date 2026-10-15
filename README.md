# 72 — Campus, in session

72 is a responsive campus event index shaped as a monochrome, scroll-led editorial experience. The story introduces the event-discovery problem, then leads into a searchable, date-filtered programme.

## Features

- Live event and event detail data from the Render72 API
- Date filters, event search, and progressive loading
- Scroll-driven storytelling and an interactive 3D spiral event index
- Stark black-and-white visual system
- Loading, empty, retry, and cached-data states for API issues
- Shareable event detail links using the `?event=<id>` query parameter

## Run locally

Serve the project root with any static HTTP server, for example:

```sh
python -m http.server 4173
```

Then open `http://localhost:4173`.
