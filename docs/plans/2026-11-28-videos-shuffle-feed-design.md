# Videos that always play, shuffles, song search, feed

## Why
Official music videos are the heart of Noctune, and today most of them fall back
to audio. Listeners also cannot see or search the songs in an album or playlist,
the shuffle is hidden, and nothing helps them discover music beyond their library.

## Goals
1. **Official videos play** whenever YouTube has one (required).
2. **YouTube account (optional):** sign in inside Noctune so videos play from the
   user's account (no ads with Premium, age-restricted videos work).
3. **Random shuffle:** the current album/playlist in random order, from the
   library *and* from a shuffle button in the player.
4. **Song list with search:** see every song of the album/playlist, filter by
   typing, start from any song. Works for 3,000+ songs.
5. **Magic shuffle:** plays songs the listener may like, including songs not in
   their library, from the library and the player.
6. **Feed tab:** recommendations based on most-played songs and playlists.

## Non-goals / anti-goals
- No ad blocker (YouTube terms forbid it; risks users' accounts). Premium sign-in is the ad-free path.
- No downloading of YouTube video files.
- No recommendation service of our own, no account on our side, nothing sent anywhere except the searches below.
- Must not slow down starting a song: audio starts at once, the video joins when ready (as today).

## Approaches considered
1. **Chosen: YouTube's own watch page inside Noctune, its interface hidden.** Plays
   label videos that refuse to embed, supports sign-in, highest quality, and its
   "related" songs feed recommendations. Risk: a YouTube page change can break it
   until an update.
2. Keep the embedded player, only find more videos: label videos still refuse to play. Rejected.
3. Download streams like downloader tools: breaks YouTube terms badly, fragile. Rejected.

## Decisions by the user
- Approach 1. Ads acceptable when not signed in to Premium; no ad blocker.
- YouTube sign-in wanted.
- Shuffle also in the player. Search bar small (the sketch is a hint, not a layout).
- Order of work: videos + sign-in → shuffles + song list/search → magic shuffle + feed.

## Design

### 1. Videos (my calls)
- **Finding:** the main process searches YouTube for `"<main artist> <title> official video"`
  using the same request YouTube's website makes, and picks the first result whose
  title matches the song and whose channel is the artist, the artist's VEVO or
  "<artist> - Topic"; length within reason of the song. MusicBrainz stays as a
  second source. Results cached like today (misses retried after 14 days).
- **Playing:** a separate browser view (own private session, sandboxed, no access to
  Noctune's bridge, navigation limited to youtube.com/google sign-in) loads the
  watch page in the stage's video area. Injected CSS hides everything but the video;
  Noctune drives play/pause/seek/volume/quality through the page's player. Highest
  quality is requested. YouTube ads run as on youtube.com; Noctune shows "Ad" and
  waits, lyrics resume with the song.
- **Fallback:** if the page fails or the video is unavailable, the song plays from its
  audio source with a notice (as today). The old embed is removed.
- **Sign-in:** Settings → Connections → YouTube: "Sign in" opens Google's page in a
  window using the same private session. "Sign out" clears that session. If Google
  refuses sign-in inside apps, the row says so; videos still play signed out.

### 2. Shuffles and song list (my calls)
- Shuffle modes: Off / Shuffle (random order of current album/playlist, every song
  once) / Magic (see 3). One button in the player cycles them (key **S**); the same
  choice appears in the library's info panel.
- Song list opens from the album (△ as today, plus a visible "Songs" hint). A small
  search field at the top filters by title/artist as you type; the list renders only
  visible rows so 3,000+ songs stay smooth. Enter plays from that song; shuffle on
  starts from it then shuffles.

### 3. Magic shuffle and feed (my calls)
- **Listening history:** Noctune counts plays per song locally (a song counts after
  30 s or half its length). Stored on the computer only; "Delete all my data" clears it.
- **Magic shuffle:** mixes the current album/playlist with songs related to it:
  YouTube's related songs for the playing track (official videos/Topic tracks only),
  roughly 1 related song every 2 library songs. Songs outside the library play as
  their YouTube video; if the user has Spotify connected and the song exists there,
  it can play from Spotify when videos are off.
- **Feed tab:** a third shelf next to Albums and Playlists: "For you" built from the
  top 10 most-played songs and artists → related songs, refreshed daily; "Because you
  played X" rows. Each item plays as a magic shuffle from it, and can be added to a playlist.
- Privacy page updated: song searches go to YouTube; history never leaves the computer.

## Left to the builder
Exact layout of the search field and shuffle button within the existing look, key
for opening the feed, how many feed items (start at ~30).

## Risks
- YouTube page changes may break playback or search until an update (fallback to audio keeps music playing).
- Google may block sign-in inside apps.
- Recommendations are only as good as YouTube's related songs.
