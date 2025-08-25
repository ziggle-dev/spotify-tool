# Changelog

All notable changes to the Spotify Tool will be documented in this file.

## [1.0.0] - 2024-08-25

### 🎉 Initial Release

#### What's New
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

#### Features
- Search for any Spotify content (tracks, albums, artists, playlists, shows, episodes)
- Control playback on active Spotify clients
- Manage your music queue
- Create and manage playlists
- Save and organize your music library
- Get personalized recommendations based on tracks/artists/genres
- Discover new music through curated playlists and new releases
- Analyze track characteristics (BPM, key, energy, etc.)
- View listening history and statistics
- Transfer playback between different devices

#### Technical Details
- Built with TypeScript and ESM modules
- Uses Spotify Web API for all operations
- Automatic credential loading from settings.json
- Beautiful OAuth callback page with auto-close
- Comprehensive error handling and user feedback
- Support for comma-separated batch operations

#### Configuration
Store your Spotify API credentials in `~/.clanker/settings.json`:
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

#### Requirements
- Spotify API credentials (get from https://developer.spotify.com/dashboard)
- Active Spotify account (free or premium)
- Spotify desktop app for playback control features