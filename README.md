# Spotify Tool for Clanker

A comprehensive Spotify client for the Clanker CLI that provides full control over your Spotify experience from the command line.

## Features

### 🎵 Music Search & Playback
- Search for tracks, albums, artists, playlists, shows, and episodes
- Control playback: play, pause, skip, previous, volume
- Advanced controls: seek, repeat, shuffle
- Open tracks directly in Spotify app

### 📚 Library Management  
- Save/unsave tracks to your library
- View saved tracks
- Check if tracks are saved

### 🎛️ Queue Management
- View current playback queue
- Add tracks to queue
- Clear entire queue

### 📋 Playlist Operations
- View all your playlists
- Create new playlists
- Add/remove tracks from playlists
- Browse playlist contents

### 👤 User Profile & Stats
- View recently played tracks
- See your top tracks and artists
- Time ranges: short term (4 weeks), medium term (6 months), long term (all time)

### 🎯 Discovery & Recommendations
- Get personalized recommendations based on tracks/artists/genres
- Browse new album releases
- Explore featured playlists
- View available genre seeds
- Analyze track audio features (tempo, energy, danceability, etc.)

### 🔊 Device Management
- List available Spotify devices
- Transfer playback between devices
- View current playback state

## Installation

```bash
npm install -g @ziggler/clanker
clanker install ziggle-dev/spotify-tool
```

## Configuration

1. Get your Spotify API credentials from [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Add them to your Clanker settings:

```json
// ~/.clanker/settings.json
{
  "tools": {
    "spotify": {
      "clientId": "your-client-id",
      "clientSecret": "your-client-secret"
    }
  }
}
```

## Usage Examples

### Basic Search
```bash
# Search for a song
clanker "search for Bohemian Rhapsody on Spotify"

# Search for albums
clanker "find Pink Floyd albums on Spotify"

# Search for playlists
clanker "search Spotify for workout playlists"
```

### Playback Control
```bash
# Control playback
clanker "pause Spotify"
clanker "play next track on Spotify"
clanker "set Spotify volume up"

# Advanced controls
clanker "enable shuffle on Spotify"
clanker "set repeat mode to track on Spotify"
clanker "seek to 30 seconds in current song"
```

### Queue Management
```bash
# View and manage queue
clanker "show my Spotify queue"
clanker "add this song to my Spotify queue: spotify:track:3n3Ppam7vgaVa1iaRUc9Lp"
clanker "clear my Spotify queue"
```

### Library Management
```bash
# Save tracks
clanker "like the current song on Spotify"
clanker "save this track: 3n3Ppam7vgaVa1iaRUc9Lp"

# View saved music
clanker "show my saved Spotify tracks"
clanker "check if track 3n3Ppam7vgaVa1iaRUc9Lp is saved"
```

### Playlists
```bash
# Create and manage playlists
clanker "create a new Spotify playlist called 'Summer Vibes'"
clanker "show my Spotify playlists"
clanker "add track spotify:track:3n3Ppam7vgaVa1iaRUc9Lp to playlist 37i9dQZF1DXcBWIGoYBM5M"
```

### User Stats
```bash
# View listening history and favorites
clanker "show my recently played Spotify tracks"
clanker "show my top artists this month on Spotify"
clanker "show my all-time favorite tracks on Spotify"
```

### Discovery
```bash
# Get recommendations
clanker "get Spotify recommendations based on track 3n3Ppam7vgaVa1iaRUc9Lp"
clanker "recommend songs based on rock and indie genres"

# Browse new music
clanker "show new album releases on Spotify"
clanker "show featured Spotify playlists"

# Audio analysis
clanker "analyze audio features of track 3n3Ppam7vgaVa1iaRUc9Lp"
```

### Authorization
```bash
# For user-specific features (first time only)
clanker "authorize Spotify access"
```

## Available Actions

- **Search**: `search`, `search-albums`, `search-artists`, `search-playlists`, `search-shows`, `search-episodes`
- **Playback**: `play`, `pause`, `next`, `previous`, `current`, `volume-up`, `volume-down`
- **Advanced**: `seek`, `repeat`, `shuffle`, `playback-state`, `devices`, `transfer`
- **Queue**: `queue`, `add-to-queue`, `clear-queue`
- **Library**: `like`, `unlike`, `check-saved`, `saved-tracks`
- **Playlists**: `playlists`, `playlist-tracks`, `create-playlist`, `add-to-playlist`, `remove-from-playlist`
- **Profile**: `recently-played`, `top-tracks`, `top-artists`
- **Discovery**: `recommendations`, `new-releases`, `featured-playlists`, `available-genres`, `audio-features`
- **Auth**: `authorize`

## Requirements

- Node.js 16+
- Spotify account (free or premium)
- Spotify API credentials
- Spotify desktop app (for playback control features)

## Platform Support

- **macOS**: Full support including native playback control via AppleScript
- **Linux**: Playback control via D-Bus interface
- **Windows**: API features supported, limited native playback control

## License

MIT

## Author

Ziggler (dev@ziggler.dev)

## Contributing

Issues and pull requests are welcome at the [GitHub repository](https://github.com/ziggle-dev/spotify-tool).