# Hippity

A social music-tracking app — think Letterboxd or Goodreads, but for what you're actually listening to. Log albums, see what friends are playing, and get recommendations based on genre and artist patterns rather than a black-box algorithm.

**Status: ~75% complete, actively in development.** Core features are functional; some flows still have bugs and a few features are unfinished. Built end-to-end with no prior coding background, using Claude Code as the primary development tool.

## Why

Film and books have strong social-tracking platforms. Music didn't have an equivalent for tracking listening history and discovery in a social, list-first way — this project scopes and builds toward that gap.

## What's working

- Album search and logging
- Weekly top tracks

## What's still in progress

- Social tab is currently a demo — user sign-in isn't live yet
- Recommendations engine sometimes fails to return results
- Upcoming and new albums sections load slowly
- General polish and testing

## Tech

- Next.js / TypeScript
- Prisma
- MusicBrainz (metadata)
- Spotify OAuth (listening data)
- Last.fm (fallback data source, added after Spotify tightened API access in February 2026)

## Notable technical decision

When Spotify restricted API access mid-build, the data layer was restructured around Last.fm as a fallback source to keep the app functional rather than stalling the project.
