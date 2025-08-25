# [Tool Submission] Spotify Tool

### Repository URL
https://github.com/ziggle-dev/spotify-tool

### Description
A comprehensive Spotify client for the Clanker CLI that provides full control over your Spotify experience from the command line. Search music, control playback, manage playlists, view statistics, and discover new music.

### Publisher
Ziggler

### Organization
ziggle-dev

### Tool Name
spotify-tool

### Commit Hash
51d1514

### Version
1.0.0

### What's New in v1.0.0

#### 🎉 Initial Release

- **Complete Spotify Client**: Full-featured Spotify controller from the command line
- **Dual Authentication**: Support for both Client Credentials (public API) and OAuth user authentication  
- **Seamless OAuth Flow**: Beautiful web-based authorization with auto-save tokens
- **Comprehensive Search**: Search tracks, albums, artists, playlists, shows, and episodes
- **Advanced Playback Controls**: Play, pause, skip, seek, repeat, shuffle, volume control
- **Queue Management**: View queue, add tracks, clear entire queue
- **Library Management**: Like/unlike tracks, check saved status, view saved library
- **Playlist Operations**: Create playlists, add/remove tracks, view all playlists
- **User Profile**: View recently played, top tracks, top artists (short/medium/long term)
- **Discovery Features**: Get recommendations, browse new releases, featured playlists
- **Audio Analysis**: Get detailed audio features for tracks (danceability, energy, tempo, etc.)
- **Device Management**: List devices, transfer playback between devices
- **Platform Support**: Native playback control for macOS (AppleScript) and Linux (D-Bus)

### Breaking Changes
N/A - Initial release

### Dependencies
- @ziggler/clanker: *
- ink: *
- react: *
- open: ^8.4.0

### Testing Instructions

1. Install the tool:
```bash
clanker install ziggle-dev/spotify-tool
```

2. Configure credentials in `~/.clanker/settings.json`:
```json
{
  "tools": {
    "spotify": {
      "clientId": "your-client-id",
      "clientSecret": "your-client-secret"
    }
  }
}
```

3. Test basic search:
```bash
clanker "search for Bohemian Rhapsody on Spotify"
```

4. Test playback control:
```bash
clanker "pause Spotify"
```

5. Test OAuth flow:
```bash
clanker "authorize Spotify access"
```

### Tool Metadata

- **Category**: Utility
- **Capabilities**: NetworkAccess, SystemExecute
- **Tags**: spotify, music, player, search, api, control, playback, queue, playlist, library
- **Min Clanker Version**: 0.1.33