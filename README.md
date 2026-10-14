# Afterhours FM

Afterhours FM is a responsive campus events site styled as an independent radio station. The light theme uses warm paper and analog radio details; dark mode adds restrained neon signal accents.

## Features

- Live event lineup from the public Render72 API.
- Search by event name, summary, category, mode, or tags.
- Tune the radio presets to all events, technical events, cultural events, or music.
- Filter by upcoming date, tonight, this week, later, or all dates (IST).
- Open event details in an accessible dialog, with shareable `?event=<uuid>` URLs.
- Detail view includes schedules, venue, description, highlights, eligibility, prizes, FAQs, and other fields returned by the API.
- Loading, empty, timeout, API error, and cached-data fallback states.
- Session cache for the lineup and lazy-loaded event cover images.
- Persisted light/dark theme and responsive mobile navigation.

## API

The app reads the public API, which requires no API key:

- `GET https://render72.pages.dev/api/test/events`
- `GET https://render72.pages.dev/api/test/events/{id}`

## Run locally

Serve this directory with any static file server, for example:

```sh
python -m http.server 4173
```

Then open `http://127.0.0.1:4173`.

## Deploy to Vercel

Import this repository into Vercel as a static site. No build command is required; the project root contains the deployable files.
