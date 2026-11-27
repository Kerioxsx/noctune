# Noctune

A retro, console-style desktop music player for macOS, Windows and Linux. Albums sit in a stack of sleeves over a halftone city; pick one and a disc slides out from behind the cover, the city turns to night, and the track opens full screen with synced lyrics or its music video.

```
app/        Electron app (React renderer, Node main process)
website/    Marketing site, with the app's web build embedded as a live demo
assets/     Shared fonts and images (disc, icon)
```

## Run it

Needs Node 22.

```bash
npm install
```

```bash
npm run dev
```

`npm run dev` opens the desktop app with hot reload. `npm run dev:web -w app` runs the same UI in a browser with the demo library only (no local files or services).

## Build installers

```bash
npm run dist -w app
```

Builds for the current OS into `app/release/`:

| OS | Formats | Install | Uninstall |
|---|---|---|---|
| macOS | `.dmg`, `.zip` (Apple silicon and Intel) | Drag Noctune to Applications | Move it to the Trash; settings are in `~/Library/Application Support/Noctune` |
| Windows | NSIS installer, portable `.exe` | Run the setup | Settings → Apps → Noctune; settings are in `%APPDATA%\Noctune` |
| Linux | AppImage, `.deb`, `.tar.gz` (x64) | `sudo apt install ./noctune_0.1.0_amd64.deb`, or make the AppImage executable and run it | `sudo apt remove noctune`, or delete the AppImage; settings are in `~/.config/Noctune` |

The GitHub Actions workflow in `.github/workflows/release.yml` builds all three on every push and pull request, and attaches them to a draft release when you push a `v*` tag. macOS builds are unsigned unless the signing secrets named in the workflow are set; unsigned builds open with right-click → Open the first time.

## Using it

| Action | Keyboard | Controller |
|---|---|---|
| Move through the stack | ↑ ↓ | D-pad, left stick |
| Albums / playlists | ← → | D-pad |
| Select / play | Enter | A (×) |
| Back | Esc | B (○) |
| Track list | I | Y (△) |
| Options (add to playlist, link video, import lyrics, change background) | O | X (□) |
| Settings | , | Start |
| Play / pause, next, previous | Space, N, P | |
| Seek ±10 s | J / L (← → in the player) | |
| Lyrics earlier / later | [ / ] | |
| Full screen | F | |

Every key can be remapped in Settings → Accessibility. Media keys work through the OS media session.

### Your music

Settings → Connections → Local files: add folders or files (MP3, FLAC, WAV, AAC/M4A, OGG/Opus, MP4/WebM). Tags and embedded artwork are read; a `.lrc` with the same name becomes the track's timed lyrics, and a video with the same name becomes its music video. Files are never modified.

### Services

| Service | What works | Setup |
|---|---|---|
| Spotify | Saved albums and playlists with covers; plays inside Noctune where the system supports Widevine, otherwise on your Spotify app, which Noctune opens if none is running (Premium) | Create an app at developer.spotify.com with redirect URI `http://127.0.0.1:43821/callback`, paste its Client ID |
| SoundCloud | Likes and playlists, with EQ; preview-only or blocked tracks fall back to another copy | Register a SoundCloud app with the same redirect URI, paste Client ID and secret |
| Apple Music | Developer-token check and catalog metadata; songs play from your files, Spotify or SoundCloud | Paste a MusicKit developer token |
| YouTube | An official video linked to a track plays in YouTube's own player; if it can't, the song plays with the visualizer | Track options → Link official video |

When a track can't play from its source (moved file, preview-only, blocked, no device), Noctune plays the same song from another source in your library and shows which one.

Sign-in happens on each service's own page in your browser. Tokens are encrypted with the OS keychain (Keychain, DPAPI, libsecret/KWallet) and never reach the renderer.

### Background and effects

Settings → Settings → Background: the halftone city or your own picture or animated GIF, with an optional print look. Interface ink switches between light and dark to stay readable on whatever is behind it. The VHS effect (scanlines and a rolling tracking band), grain, vignette and transition glitches can each be turned off; reduced motion follows the system setting.

## Demo library

The six demo albums (music, one music video, timed lyrics and cover art) are generated in code: `npm run gen:demo -w app` (needs ffmpeg) recreates `app/public/demo/`. No third-party media is included.

## Website

```bash
npm run build -w website
```

Outputs a static site in `website/dist/`, including the app's web build at `/app/` as the live demo in the hero. Pushes to `main` deploy it to GitHub Pages once Pages is switched on (Settings → Pages → Source: GitHub Actions); it will be at https://kerioxsx.github.io/noctune/.
