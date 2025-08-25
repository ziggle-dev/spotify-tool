// @ts-ignore
import { createTool, ToolCategory, ToolCapability } from '@ziggler/clanker';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as http from 'http';
import { platform } from 'os';
import * as url from 'url';

const execAsync = promisify(exec);

// Helper function to open URLs without the 'open' package
async function openUrl(urlToOpen: string): Promise<void> {
  const os = platform();
  let command: string;
  
  switch (os) {
    case 'darwin':
      command = `open "${urlToOpen}"`;
      break;
    case 'win32':
      command = `start "" "${urlToOpen}"`;
      break;
    default: // Linux and others
      command = `xdg-open "${urlToOpen}"`;
      break;
  }
  
  try {
    await execAsync(command);
  } catch (error) {
    // Fallback - just log the URL
    console.log(`Please open this URL in your browser: ${urlToOpen}`);
  }
}

interface SpotifyToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  artists: Array<{ name: string }>;
  album: { name: string };
  external_urls: { spotify: string };
}

interface SpotifySearchResult {
  tracks?: {
    items: SpotifyTrack[];
  };
}

interface SpotifyPlaylist {
  id: string;
  name: string;
  external_urls: { spotify: string };
}

interface SpotifyQueue {
  currently_playing?: SpotifyTrack;
  queue: SpotifyTrack[];
}

// Helper function to create a temporary callback server
async function createCallbackServer(): Promise<{ server: http.Server; tokenPromise: Promise<string> }> {
  return new Promise((resolve) => {
    let tokenResolve: (token: string) => void;
    const tokenPromise = new Promise<string>((res) => { tokenResolve = res; });
    
    const server = http.createServer((req, res) => {
      const reqUrl = url.parse(req.url || '', true);
      
      if (reqUrl.pathname === '/callback') {
        // Send HTML page that extracts token from URL fragment
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Spotify Authorization</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
              }
              .container {
                text-align: center;
                padding: 2rem;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 12px;
                backdrop-filter: blur(10px);
              }
              h1 { margin-bottom: 1rem; }
              .success { color: #4ade80; font-size: 3rem; }
              .error { color: #f87171; }
              .close { 
                margin-top: 2rem;
                padding: 0.5rem 1rem;
                background: rgba(255, 255, 255, 0.2);
                border: none;
                border-radius: 6px;
                color: white;
                cursor: pointer;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div id="status">Processing...</div>
            </div>
            <script>
              // Extract token from URL fragment
              const hash = window.location.hash.substring(1);
              const params = new URLSearchParams(hash);
              const token = params.get('access_token');
              const error = params.get('error');
              
              const statusEl = document.getElementById('status');
              
              if (token) {
                // Send token to server
                fetch('/save-token', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ token })
                }).then(() => {
                  statusEl.innerHTML = \`
                    <div class="success">✓</div>
                    <h1>Authorization Successful!</h1>
                    <p>You can close this window and return to the terminal.</p>
                    <button class="close" onclick="window.close()">Close Window</button>
                  \`;
                  setTimeout(() => window.close(), 3000);
                });
              } else if (error) {
                statusEl.innerHTML = \`
                  <h1 class="error">Authorization Failed</h1>
                  <p>\${error}</p>
                  <button class="close" onclick="window.close()">Close Window</button>
                \`;
              } else {
                statusEl.innerHTML = \`
                  <h1 class="error">No Token Received</h1>
                  <p>Please try again.</p>
                  <button class="close" onclick="window.close()">Close Window</button>
                \`;
              }
            </script>
          </body>
          </html>
        `);
      } else if (reqUrl.pathname === '/save-token' && req.method === 'POST') {
        // Handle token save request
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const { token } = JSON.parse(body);
            if (token) {
              tokenResolve(token);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true }));
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'No token provided' }));
            }
          } catch (error) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid request' }));
          }
        });
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    
    server.listen(8888, () => {
      resolve({ server, tokenPromise });
    });
  });
}

// Helper function to initiate OAuth flow
async function initiateOAuthFlow(clientId: string, context: any): Promise<string> {
  const scopes = [
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-currently-playing',
    'playlist-modify-public',
    'playlist-modify-private',
    'playlist-read-private',
    'user-library-modify',
    'user-library-read'
  ].join(' ');
  
  const redirectUri = 'http://localhost:8888/callback';
  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.searchParams.append('client_id', clientId);
  authUrl.searchParams.append('response_type', 'token');
  authUrl.searchParams.append('redirect_uri', redirectUri);
  authUrl.searchParams.append('scope', scopes);
  authUrl.searchParams.append('show_dialog', 'true');
  
  return authUrl.toString();
}

// Helper function to get user access token from settings or prompt
async function getUserToken(clientId: string, clientSecret: string, context: any): Promise<string | null> {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    
    const settingsPath = path.join(os.homedir(), '.clanker', 'settings.json');
    const settingsData = await fs.readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(settingsData);
    
    // Check if we have a stored token
    let token = settings?.tools?.spotify?.userToken;
    
    // If we have a refresh token, use it to get a new access token
    if (settings?.tools?.spotify?.refreshToken) {
      const refreshToken = settings.tools.spotify.refreshToken;
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      
      try {
        const response = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: `grant_type=refresh_token&refresh_token=${refreshToken}`
        });
        
        if (response.ok) {
          const data = await response.json() as any;
          token = data.access_token;
          
          // Save the new token
          settings.tools.spotify.userToken = token;
          if (data.refresh_token) {
            settings.tools.spotify.refreshToken = data.refresh_token;
          }
          await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
          
          return token;
        }
      } catch (error) {
        context.logger?.debug('Failed to refresh token:', error);
      }
    }
    
    return token || null;
  } catch {
    return null;
  }
}

// Add track to queue
async function addToQueue(trackUri: string, userToken: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(trackUri)}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Failed to add to queue: ${error}` };
    }
    
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Get current queue
async function getQueue(userToken: string): Promise<{ success: boolean; queue?: SpotifyQueue; error?: string }> {
  try {
    const response = await fetch('https://api.spotify.com/v1/me/player/queue', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${userToken}`
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Failed to get queue: ${error}` };
    }
    
    const queue = await response.json() as SpotifyQueue;
    return { success: true, queue };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Save/like a track
async function saveTrack(trackId: string, userToken: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`https://api.spotify.com/v1/me/tracks?ids=${trackId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Failed to save track: ${error}` };
    }
    
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Remove/unlike a track
async function removeTrack(trackId: string, userToken: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`https://api.spotify.com/v1/me/tracks?ids=${trackId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${userToken}`
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Failed to remove track: ${error}` };
    }
    
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Check if tracks are saved
async function checkSavedTracks(trackIds: string[], userToken: string): Promise<{ success: boolean; saved?: boolean[]; error?: string }> {
  try {
    const response = await fetch(`https://api.spotify.com/v1/me/tracks/contains?ids=${trackIds.join(',')}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${userToken}`
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Failed to check saved tracks: ${error}` };
    }
    
    const saved = await response.json() as boolean[];
    return { success: true, saved };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Skip to next track
async function skipToNext(userToken: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch('https://api.spotify.com/v1/me/player/next', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`
      }
    });
    
    if (!response.ok && response.status !== 204) {
      const error = await response.text();
      return { success: false, error: `Failed to skip track: ${error}` };
    }
    
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Get user's saved tracks
async function getSavedTracks(limit: number, offset: number, userToken: string): Promise<{ success: boolean; tracks?: any; error?: string }> {
  try {
    const response = await fetch(`https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${userToken}`
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Failed to get saved tracks: ${error}` };
    }
    
    const tracks = await response.json() as any;
    return { success: true, tracks };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Get user's playlists
async function getUserPlaylists(limit: number, userToken: string): Promise<{ success: boolean; playlists?: any; error?: string }> {
  try {
    const response = await fetch(`https://api.spotify.com/v1/me/playlists?limit=${limit}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${userToken}`
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Failed to get playlists: ${error}` };
    }
    
    const playlists = await response.json() as any;
    return { success: true, playlists };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Get playlist tracks
async function getPlaylistTracks(playlistId: string, userToken: string): Promise<{ success: boolean; tracks?: any; error?: string }> {
  try {
    const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${userToken}`
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Failed to get playlist tracks: ${error}` };
    }
    
    const tracks = await response.json() as any;
    return { success: true, tracks };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Remove tracks from playlist
async function removeFromPlaylist(playlistId: string, trackUris: string[], userToken: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tracks: trackUris.map(uri => ({ uri }))
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Failed to remove from playlist: ${error}` };
    }
    
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Get playback state
async function getPlaybackState(userToken: string): Promise<{ success: boolean; state?: any; error?: string }> {
  try {
    const response = await fetch('https://api.spotify.com/v1/me/player', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${userToken}`
      }
    });
    
    if (response.status === 204) {
      return { success: true, state: null };
    }
    
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Failed to get playback state: ${error}` };
    }
    
    const state = await response.json() as any;
    return { success: true, state };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Set repeat mode
async function setRepeatMode(mode: string, userToken: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`https://api.spotify.com/v1/me/player/repeat?state=${mode}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${userToken}`
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Failed to set repeat mode: ${error}` };
    }
    
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Set shuffle mode
async function setShuffleMode(state: boolean, userToken: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`https://api.spotify.com/v1/me/player/shuffle?state=${state}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${userToken}`
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Failed to set shuffle mode: ${error}` };
    }
    
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Seek to position
async function seekToPosition(position: number, userToken: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`https://api.spotify.com/v1/me/player/seek?position_ms=${position}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${userToken}`
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Failed to seek: ${error}` };
    }
    
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Get available devices
async function getDevices(userToken: string): Promise<{ success: boolean; devices?: any; error?: string }> {
  try {
    const response = await fetch('https://api.spotify.com/v1/me/player/devices', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${userToken}`
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Failed to get devices: ${error}` };
    }
    
    const data = await response.json() as any;
    return { success: true, devices: data.devices };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Transfer playback
async function transferPlayback(deviceId: string, play: boolean, userToken: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch('https://api.spotify.com/v1/me/player', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        device_ids: [deviceId],
        play
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Failed to transfer playback: ${error}` };
    }
    
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Get recently played
async function getRecentlyPlayed(limit: number, userToken: string): Promise<{ success: boolean; items?: any; error?: string }> {
  try {
    const response = await fetch(`https://api.spotify.com/v1/me/player/recently-played?limit=${limit}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${userToken}`
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Failed to get recently played: ${error}` };
    }
    
    const data = await response.json() as any;
    return { success: true, items: data.items };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Get user's top items (tracks or artists)
async function getTopItems(type: string, limit: number, userToken: string): Promise<{ success: boolean; items?: any; error?: string }> {
  try {
    const response = await fetch(`https://api.spotify.com/v1/me/top/${type}?limit=${limit}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${userToken}`
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Failed to get top ${type}: ${error}` };
    }
    
    const data = await response.json() as any;
    return { success: true, items: data.items };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Get recommendations based on seed tracks/artists/genres
async function getRecommendations(seedTracks: string[], seedArtists: string[], seedGenres: string[], limit: number, accessToken: string): Promise<{ success: boolean; tracks?: any; error?: string }> {
  try {
    const url = new URL('https://api.spotify.com/v1/recommendations');
    
    if (seedTracks.length > 0) url.searchParams.append('seed_tracks', seedTracks.join(','));
    if (seedArtists.length > 0) url.searchParams.append('seed_artists', seedArtists.join(','));
    if (seedGenres.length > 0) url.searchParams.append('seed_genres', seedGenres.join(','));
    url.searchParams.append('limit', limit.toString());
    
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Failed to get recommendations: ${error}` };
    }
    
    const data = await response.json() as any;
    return { success: true, tracks: data.tracks };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Get available genre seeds for recommendations
async function getAvailableGenres(accessToken: string): Promise<{ success: boolean; genres?: string[]; error?: string }> {
  try {
    const response = await fetch('https://api.spotify.com/v1/recommendations/available-genre-seeds', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Failed to get genres: ${error}` };
    }
    
    const data = await response.json() as any;
    return { success: true, genres: data.genres };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Get new releases
async function getNewReleases(limit: number, accessToken: string): Promise<{ success: boolean; albums?: any; error?: string }> {
  try {
    const response = await fetch(`https://api.spotify.com/v1/browse/new-releases?limit=${limit}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Failed to get new releases: ${error}` };
    }
    
    const data = await response.json() as any;
    return { success: true, albums: data.albums.items };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Get featured playlists
async function getFeaturedPlaylists(limit: number, accessToken: string): Promise<{ success: boolean; playlists?: any; message?: string; error?: string }> {
  try {
    const response = await fetch(`https://api.spotify.com/v1/browse/featured-playlists?limit=${limit}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Failed to get featured playlists: ${error}` };
    }
    
    const data = await response.json() as any;
    return { success: true, playlists: data.playlists.items, message: data.message };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Get track audio features
async function getAudioFeatures(trackId: string, accessToken: string): Promise<{ success: boolean; features?: any; error?: string }> {
  try {
    const response = await fetch(`https://api.spotify.com/v1/audio-features/${trackId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Failed to get audio features: ${error}` };
    }
    
    const features = await response.json() as any;
    return { success: true, features };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Search for any type
async function searchSpotify(query: string, types: string[], limit: number, accessToken: string): Promise<{ success: boolean; results?: any; error?: string }> {
  try {
    const searchUrl = new URL('https://api.spotify.com/v1/search');
    searchUrl.searchParams.append('q', query);
    searchUrl.searchParams.append('type', types.join(','));
    searchUrl.searchParams.append('limit', limit.toString());
    
    const response = await fetch(searchUrl.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Search failed: ${error}` };
    }
    
    const results = await response.json() as any;
    return { success: true, results };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Create a playlist
async function createPlaylist(name: string, description: string, userToken: string): Promise<{ success: boolean; playlist?: SpotifyPlaylist; error?: string }> {
  try {
    // First get user ID
    const userResponse = await fetch('https://api.spotify.com/v1/me', {
      headers: {
        'Authorization': `Bearer ${userToken}`
      }
    });
    
    if (!userResponse.ok) {
      return { success: false, error: 'Failed to get user information' };
    }
    
    const user = await userResponse.json() as any;
    const userId = user.id;
    
    // Create playlist
    const response = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name,
        description,
        public: false
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Failed to create playlist: ${error}` };
    }
    
    const playlist = await response.json() as SpotifyPlaylist;
    return { success: true, playlist };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Add tracks to playlist
async function addToPlaylist(playlistId: string, trackUris: string[], userToken: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        uris: trackUris
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Failed to add to playlist: ${error}` };
    }
    
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function controlSpotify(action: string): Promise<{ success: boolean; output?: string; error?: string }> {
  const platform = process.platform;
  
  try {
    let command: string;
    
    switch (platform) {
      case 'darwin': // macOS
        switch (action) {
          case 'play':
            command = 'osascript -e \'tell application "Spotify" to play\'';
            break;
          case 'pause':
            command = 'osascript -e \'tell application "Spotify" to pause\'';
            break;
          case 'next':
            command = 'osascript -e \'tell application "Spotify" to next track\'';
            break;
          case 'previous':
            command = 'osascript -e \'tell application "Spotify" to previous track\'';
            break;
          case 'volume-up':
            command = 'osascript -e \'tell application "Spotify" to set sound volume to (sound volume + 10)\'';
            break;
          case 'volume-down':
            command = 'osascript -e \'tell application "Spotify" to set sound volume to (sound volume - 10)\'';
            break;
          case 'current':
            command = `osascript -e '
              tell application "Spotify"
                set trackName to name of current track
                set artistName to artist of current track
                set albumName to album of current track
                return trackName & " by " & artistName & " from " & albumName
              end tell'`;
            break;
          default:
            return { success: false, error: `Unknown action: ${action}` };
        }
        break;
        
      case 'linux':
        // Use D-Bus on Linux
        switch (action) {
          case 'play':
            command = 'dbus-send --print-reply --dest=org.mpris.MediaPlayer2.spotify /org/mpris/MediaPlayer2 org.mpris.MediaPlayer2.Player.Play';
            break;
          case 'pause':
            command = 'dbus-send --print-reply --dest=org.mpris.MediaPlayer2.spotify /org/mpris/MediaPlayer2 org.mpris.MediaPlayer2.Player.Pause';
            break;
          case 'next':
            command = 'dbus-send --print-reply --dest=org.mpris.MediaPlayer2.spotify /org/mpris/MediaPlayer2 org.mpris.MediaPlayer2.Player.Next';
            break;
          case 'previous':
            command = 'dbus-send --print-reply --dest=org.mpris.MediaPlayer2.spotify /org/mpris/MediaPlayer2 org.mpris.MediaPlayer2.Player.Previous';
            break;
          default:
            return { success: false, error: `Action "${action}" not supported on Linux yet` };
        }
        break;
        
      case 'win32':
        // Windows - use Spotify Web API or AutoHotkey
        return { 
          success: false, 
          error: 'Windows playback control not yet implemented. Please use the Spotify Web API.' 
        };
        
      default:
        return { success: false, error: `Platform ${platform} not supported` };
    }
    
    const { stdout, stderr } = await execAsync(command);
    
    if (stderr && !stderr.includes('WARNING')) {
      return { success: false, error: stderr };
    }
    
    return { 
      success: true, 
      output: stdout.trim() || `Successfully executed: ${action}` 
    };
    
  } catch (error) {
    return { 
      success: false, 
      error: `Failed to control Spotify: ${error instanceof Error ? error.message : String(error)}` 
    };
  }
}

export default createTool()
  .id('spotify-tool')
  .name('Spotify Tool')
  .description('Search for songs on Spotify, control playback, and open tracks in the Spotify app')
  .category(ToolCategory.Utility)
  .capabilities(ToolCapability.NetworkAccess, ToolCapability.SystemExecute)
  .tags('spotify', 'music', 'player', 'search', 'api', 'control', 'playback')
  
  .stringArg('action', 'Action to perform - see examples for full list', { 
    required: false,
    default: 'search',
    validate: (value: any) => {
      const validActions = [
        // Search
        'search', 'search-albums', 'search-artists', 'search-playlists', 'search-shows', 'search-episodes',
        // Playback Control
        'play', 'pause', 'next', 'previous', 'current', 
        'volume-up', 'volume-down', 'seek', 'repeat', 'shuffle',
        'playback-state', 'devices', 'transfer',
        // Queue Management  
        'queue', 'add-to-queue', 'clear-queue',
        // Library Management
        'like', 'unlike', 'check-saved', 'saved-tracks',
        // Playlist Management
        'playlists', 'playlist-tracks', 'create-playlist', 
        'add-to-playlist', 'remove-from-playlist', 
        // User Profile
        'recently-played', 'top-tracks', 'top-artists',
        // Discovery & Recommendations
        'recommendations', 'new-releases', 'featured-playlists', 
        'available-genres', 'audio-features',
        // Authorization
        'authorize'
      ];
      if (!validActions.includes(value as string)) {
        return `Invalid action. Valid actions are: ${validActions.join(', ')}`;
      }
      return true;
    }
  })
  
  .stringArg('query', 'The song, artist, or album to search for (required for search action)', { 
    required: false,
    validate: (value: any) => {
      if ((value as string).length < 2) {
        return 'Search query must be at least 2 characters';
      }
      return true;
    }
  })
  
  .stringArg('clientId', 'Spotify API Client ID', { 
    required: false
  })
  
  .stringArg('clientSecret', 'Spotify API Client Secret', { 
    required: false
  })
  
  .numberArg('limit', 'Number of results to return', { 
    default: 5,
    validate: (value: any) => {
      if ((value as number) < 1 || (value as number) > 50) {
        return 'Limit must be between 1 and 50';
      }
      return true;
    }
  })
  
  .booleanArg('openFirst', 'Automatically open the first result in Spotify', { 
    default: false 
  })
  
  .booleanArg('showUrl', 'Show Spotify web URLs in results', { 
    default: false 
  })
  
  .stringArg('trackId', 'Track ID for like/add-to-queue actions', {
    required: false
  })
  
  .stringArg('trackUri', 'Track URI for add-to-queue action', {
    required: false
  })
  
  .stringArg('playlistName', 'Name for new playlist', {
    required: false
  })
  
  .stringArg('playlistDescription', 'Description for new playlist', {
    required: false,
    default: ''
  })
  
  .stringArg('playlistId', 'Playlist ID to add tracks to', {
    required: false
  })
  
  .stringArg('userToken', 'Spotify user access token for user-specific actions', {
    required: false
  })
  
  .numberArg('position', 'Position in queue (for remove-from-queue) or milliseconds (for seek)', {
    required: false
  })
  
  .stringArg('deviceId', 'Device ID for transfer playback', {
    required: false
  })
  
  .stringArg('repeatMode', 'Repeat mode: off, track, or context', {
    required: false,
    default: 'off'
  })
  
  .booleanArg('shuffleState', 'Enable or disable shuffle', {
    required: false,
    default: false
  })
  
  .numberArg('offset', 'Offset for paginated results', {
    required: false,
    default: 0
  })
  
  .stringArg('searchType', 'Type of search: track, album, artist, playlist, show, episode', {
    required: false,
    default: 'track'
  })
  
  .stringArg('timeRange', 'Time range for top items: short_term, medium_term, long_term', {
    required: false,
    default: 'medium_term'
  })
  
  .stringArg('seedTracks', 'Comma-separated track IDs for recommendations', {
    required: false
  })
  
  .stringArg('seedArtists', 'Comma-separated artist IDs for recommendations', {
    required: false
  })
  
  .stringArg('seedGenres', 'Comma-separated genres for recommendations', {
    required: false
  })
  
  .onInitialize(async (context: any) => {
    context.logger?.debug('Spotify tool initialized');
  })
  
  .execute(async (args: any, context: any) => {
    let { 
      action = 'search', 
      query, 
      clientId, 
      clientSecret, 
      limit = 5, 
      openFirst = false, 
      showUrl = false,
      trackId,
      trackUri,
      playlistName,
      playlistDescription = '',
      playlistId,
      userToken,
      position,
      deviceId,
      repeatMode = 'off',
      shuffleState = false,
      offset = 0,
      searchType = 'track',
      timeRange = 'medium_term',
      seedTracks,
      seedArtists,
      seedGenres
    } = args;
    
    try {
      // Handle authorize action
      if (action === 'authorize') {
        // Get client credentials
        if (!clientId || !clientSecret) {
          try {
            const fs = await import('fs/promises');
            const path = await import('path');
            const os = await import('os');
            
            const settingsPath = path.join(os.homedir(), '.clanker', 'settings.json');
            const settingsData = await fs.readFile(settingsPath, 'utf-8');
            const settings = JSON.parse(settingsData);
            
            const spotifySettings = settings?.tools?.spotify;
            if (spotifySettings) {
              if (spotifySettings.clientId && !clientId) {
                clientId = spotifySettings.clientId;
              }
              if (spotifySettings.clientSecret && !clientSecret) {
                clientSecret = spotifySettings.clientSecret;
              }
            }
          } catch (error) {
            context.logger?.debug('Could not read settings:', error);
          }
        }
        
        if (!clientId) {
          return {
            success: false,
            error: 'Client ID is required for authorization. Please provide it or set it in settings.'
          };
        }
        
        try {
          // Create callback server
          context.logger?.info('Starting authorization server on http://localhost:8888');
          const { server, tokenPromise } = await createCallbackServer();
          
          // Generate auth URL
          const authUrl = await initiateOAuthFlow(clientId, context);
          
          // Open browser
          context.logger?.info('Opening Spotify authorization in browser...');
          await openUrl(authUrl);
          
          // Wait for token with timeout
          const timeoutPromise = new Promise<string>((_, reject) => {
            setTimeout(() => reject(new Error('Authorization timeout')), 120000); // 2 minute timeout
          });
          
          try {
            const token = await Promise.race([tokenPromise, timeoutPromise]);
            
            // Save token to settings
            const fs = await import('fs/promises');
            const path = await import('path');
            const os = await import('os');
            
            const settingsPath = path.join(os.homedir(), '.clanker', 'settings.json');
            let settings: any = {};
            
            try {
              const settingsData = await fs.readFile(settingsPath, 'utf-8');
              settings = JSON.parse(settingsData);
            } catch {
              // Settings file doesn't exist yet
            }
            
            // Ensure the structure exists
            if (!settings.tools) settings.tools = {};
            if (!settings.tools.spotify) settings.tools.spotify = {};
            
            // Save the token
            settings.tools.spotify.userToken = token;
            
            // Write settings back
            await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
            
            // Close server
            server.close();
            
            return {
              success: true,
              output: `✅ Authorization successful!\n\n` +
                      `Your Spotify access token has been saved to settings.\n` +
                      `You can now use all Spotify features including:\n` +
                      `• View and manage queue\n` +
                      `• Like/save songs\n` +
                      `• Create and manage playlists\n\n` +
                      `Try: "Show my Spotify queue" or "Like this song"`
            };
          } catch (error) {
            server.close();
            
            if (error instanceof Error && error.message === 'Authorization timeout') {
              return {
                success: false,
                error: 'Authorization timed out. Please try again.'
              };
            }
            throw error;
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to complete authorization: ${error instanceof Error ? error.message : String(error)}`
          };
        }
      }
      
      // Handle user-specific actions (require user token)
      const userActions = [
        'queue', 'add-to-queue', 'clear-queue', 'remove-from-queue',
        'like', 'unlike', 'check-saved', 'saved-tracks',
        'create-playlist', 'add-to-playlist', 'remove-from-playlist', 'playlists', 'playlist-tracks',
        'recently-played', 'top-tracks', 'top-artists',
        'playback-state', 'devices', 'transfer', 'seek', 'repeat', 'shuffle',
        'search-albums', 'search-artists', 'search-playlists', 'search-shows', 'search-episodes'
      ];
      
      if (userActions.includes(action)) {
        // Get client credentials first
        if (!clientId || !clientSecret) {
          // Try to get from settings
          try {
            const fs = await import('fs/promises');
            const path = await import('path');
            const os = await import('os');
            
            const settingsPath = path.join(os.homedir(), '.clanker', 'settings.json');
            const settingsData = await fs.readFile(settingsPath, 'utf-8');
            const settings = JSON.parse(settingsData);
            
            const spotifySettings = settings?.tools?.spotify;
            if (spotifySettings) {
              if (spotifySettings.clientId && !clientId) {
                clientId = spotifySettings.clientId;
              }
              if (spotifySettings.clientSecret && !clientSecret) {
                clientSecret = spotifySettings.clientSecret;
              }
            }
          } catch (error) {
            context.logger?.debug('Could not read settings for OAuth:', error);
          }
        }
        
        // Try to get user token from settings if not provided
        if (!userToken && clientId && clientSecret) {
          userToken = await getUserToken(clientId, clientSecret, context);
        }
        
        if (!userToken) {
          if (!clientId) {
            return {
              success: false,
              error: `${action} requires Spotify API credentials. Please provide clientId and clientSecret.`
            };
          }
          
          const authUrl = await initiateOAuthFlow(clientId, context);
          
          return {
            success: false,
            error: `${action} requires user authentication. Please authorize the app:\n\n` +
                   `1. Open this URL in your browser:\n   ${authUrl}\n\n` +
                   `2. After authorizing, you'll be redirected to a URL like:\n` +
                   `   http://localhost:8888/callback#access_token=YOUR_TOKEN&...\n\n` +
                   `3. Copy the access_token value from the URL\n\n` +
                   `4. Run this command again with userToken argument:\n` +
                   `   --userToken "YOUR_TOKEN"\n\n` +
                   `Or save it to settings for automatic use.`
          };
        }
        
        switch (action) {
          case 'queue': {
            const result = await getQueue(userToken);
            if (!result.success) {
              return result;
            }
            
            let output = 'Current Queue:\n\n';
            
            if (result.queue?.currently_playing) {
              const current = result.queue.currently_playing;
              output += `Now Playing:\n`;
              output += `  ${current.name} by ${current.artists.map(a => a.name).join(', ')}\n\n`;
            }
            
            if (result.queue?.queue && result.queue.queue.length > 0) {
              output += 'Up Next:\n';
              result.queue.queue.slice(0, 10).forEach((track, index) => {
                output += `  ${index + 1}. ${track.name} by ${track.artists.map(a => a.name).join(', ')}\n`;
              });
              
              if (result.queue.queue.length > 10) {
                output += `  ... and ${result.queue.queue.length - 10} more tracks\n`;
              }
            } else {
              output += 'Queue is empty\n';
            }
            
            return { success: true, output };
          }
          
          case 'add-to-queue': {
            if (!trackUri) {
              return { success: false, error: 'trackUri is required for add-to-queue action' };
            }
            
            const result = await addToQueue(trackUri, userToken);
            if (!result.success) {
              return result;
            }
            
            return { success: true, output: `✓ Added track to queue` };
          }
          
          case 'like': {
            if (!trackId) {
              return { success: false, error: 'trackId is required for like action' };
            }
            
            const result = await saveTrack(trackId, userToken);
            if (!result.success) {
              return result;
            }
            
            return { success: true, output: `✓ Saved track to your library` };
          }
          
          case 'create-playlist': {
            if (!playlistName) {
              return { success: false, error: 'playlistName is required for create-playlist action' };
            }
            
            const result = await createPlaylist(playlistName, playlistDescription, userToken);
            if (!result.success) {
              return result;
            }
            
            return { 
              success: true, 
              output: `✓ Created playlist "${playlistName}"\nPlaylist ID: ${result.playlist?.id}\nURL: ${result.playlist?.external_urls.spotify}`
            };
          }
          
          case 'add-to-playlist': {
            if (!playlistId || !trackUri) {
              return { success: false, error: 'playlistId and trackUri are required for add-to-playlist action' };
            }
            
            const trackUris = trackUri.includes(',') ? trackUri.split(',').map((u: string) => u.trim()) : [trackUri];
            const result = await addToPlaylist(playlistId, trackUris, userToken);
            if (!result.success) {
              return result;
            }
            
            return { success: true, output: `✓ Added ${trackUris.length} track(s) to playlist` };
          }
          
          case 'clear-queue': {
            // Get current queue
            const queueResult = await getQueue(userToken);
            if (!queueResult.success || !queueResult.queue?.queue) {
              return { success: false, error: 'Failed to get current queue' };
            }
            
            // Skip through all tracks in queue
            let skipped = 0;
            for (let i = 0; i < queueResult.queue.queue.length; i++) {
              const result = await skipToNext(userToken);
              if (!result.success) break;
              skipped++;
              await new Promise(resolve => setTimeout(resolve, 500)); // Small delay between skips
            }
            
            return { success: true, output: `✓ Cleared ${skipped} tracks from queue` };
          }
          
          case 'remove-from-queue': {
            if (position === undefined) {
              return { success: false, error: 'position is required for remove-from-queue action' };
            }
            
            // This is a limitation of Spotify API - can't remove specific items from queue
            // We can only skip to next
            return { 
              success: false, 
              error: 'Spotify API does not support removing specific items from queue. You can only skip tracks or clear the entire queue.'
            };
          }
          
          case 'unlike': {
            if (!trackId) {
              return { success: false, error: 'trackId is required for unlike action' };
            }
            
            const result = await removeTrack(trackId, userToken);
            if (!result.success) {
              return result;
            }
            
            return { success: true, output: `✓ Removed track from your library` };
          }
          
          case 'check-saved': {
            if (!trackId) {
              return { success: false, error: 'trackId is required for check-saved action' };
            }
            
            const trackIds = trackId.includes(',') ? trackId.split(',').map((id: string) => id.trim()) : [trackId];
            const result = await checkSavedTracks(trackIds, userToken);
            if (!result.success) {
              return result;
            }
            
            let output = 'Track saved status:\n';
            trackIds.forEach((id: string, index: number) => {
              output += `  ${id}: ${result.saved?.[index] ? '✓ Saved' : '✗ Not saved'}\n`;
            });
            
            return { success: true, output };
          }
          
          case 'saved-tracks': {
            const result = await getSavedTracks(limit, offset, userToken);
            if (!result.success) {
              return result;
            }
            
            if (!result.tracks || result.tracks.length === 0) {
              return { success: true, output: 'No saved tracks found' };
            }
            
            let output = `Saved tracks (${result.tracks.length}):\n\n`;
            result.tracks.forEach((item: any, index: number) => {
              const track = item.track;
              output += `${offset + index + 1}. ${track.name}\n`;
              output += `   Artist: ${track.artists.map((a: any) => a.name).join(', ')}\n`;
              output += `   Album: ${track.album.name}\n`;
              output += `   ID: ${track.id}\n\n`;
            });
            
            return { success: true, output };
          }
          
          case 'playlists': {
            const result = await getUserPlaylists(limit, userToken);
            if (!result.success) {
              return result;
            }
            
            if (!result.playlists || result.playlists.length === 0) {
              return { success: true, output: 'No playlists found' };
            }
            
            let output = `Your playlists (${result.playlists.length}):\n\n`;
            result.playlists.forEach((playlist: any, index: number) => {
              output += `${index + 1}. ${playlist.name}\n`;
              output += `   ID: ${playlist.id}\n`;
              output += `   Tracks: ${playlist.tracks.total}\n`;
              output += `   Public: ${playlist.public ? 'Yes' : 'No'}\n`;
              if (playlist.description) {
                output += `   Description: ${playlist.description}\n`;
              }
              output += `   URL: ${playlist.external_urls.spotify}\n\n`;
            });
            
            return { success: true, output };
          }
          
          case 'playlist-tracks': {
            if (!playlistId) {
              return { success: false, error: 'playlistId is required for playlist-tracks action' };
            }
            
            const result = await getPlaylistTracks(playlistId, userToken);
            if (!result.success) {
              return result;
            }
            
            if (!result.tracks || result.tracks.length === 0) {
              return { success: true, output: 'No tracks in playlist' };
            }
            
            let output = `Playlist tracks (${result.tracks.length}):\n\n`;
            result.tracks.forEach((item: any, index: number) => {
              const track = item.track;
              if (track) {
                output += `${index + 1}. ${track.name}\n`;
                output += `   Artist: ${track.artists.map((a: any) => a.name).join(', ')}\n`;
                output += `   Album: ${track.album.name}\n`;
                output += `   URI: ${track.uri}\n\n`;
              }
            });
            
            return { success: true, output };
          }
          
          case 'remove-from-playlist': {
            if (!playlistId || !trackUri) {
              return { success: false, error: 'playlistId and trackUri are required for remove-from-playlist action' };
            }
            
            const trackUris = trackUri.includes(',') ? trackUri.split(',').map((u: string) => u.trim()) : [trackUri];
            const result = await removeFromPlaylist(playlistId, trackUris, userToken);
            if (!result.success) {
              return result;
            }
            
            return { success: true, output: `✓ Removed ${trackUris.length} track(s) from playlist` };
          }
          
          case 'recently-played': {
            const result = await getRecentlyPlayed(limit, userToken);
            if (!result.success) {
              return result;
            }
            
            if (!result.items || result.items.length === 0) {
              return { success: true, output: 'No recently played tracks' };
            }
            
            let output = `Recently played (${result.items.length}):\n\n`;
            result.items.forEach((item: any, index: number) => {
              const track = item.track;
              output += `${index + 1}. ${track.name}\n`;
              output += `   Artist: ${track.artists.map((a: any) => a.name).join(', ')}\n`;
              output += `   Album: ${track.album.name}\n`;
              output += `   Played at: ${new Date(item.played_at).toLocaleString()}\n\n`;
            });
            
            return { success: true, output };
          }
          
          case 'top-tracks': {
            const result = await getTopItems('tracks', limit, userToken);
            if (!result.success) {
              return result;
            }
            
            if (!result.items || result.items.length === 0) {
              return { success: true, output: 'No top tracks found' };
            }
            
            let output = `Your top tracks (${timeRange}):\n\n`;
            result.items.forEach((track: any, index: number) => {
              output += `${index + 1}. ${track.name}\n`;
              output += `   Artist: ${track.artists.map((a: any) => a.name).join(', ')}\n`;
              output += `   Album: ${track.album.name}\n`;
              output += `   ID: ${track.id}\n\n`;
            });
            
            return { success: true, output };
          }
          
          case 'top-artists': {
            const result = await getTopItems('artists', limit, userToken);
            if (!result.success) {
              return result;
            }
            
            if (!result.items || result.items.length === 0) {
              return { success: true, output: 'No top artists found' };
            }
            
            let output = `Your top artists (${timeRange}):\n\n`;
            result.items.forEach((artist: any, index: number) => {
              output += `${index + 1}. ${artist.name}\n`;
              output += `   Genres: ${artist.genres.join(', ') || 'N/A'}\n`;
              output += `   Followers: ${artist.followers.total.toLocaleString()}\n`;
              output += `   URL: ${artist.external_urls.spotify}\n\n`;
            });
            
            return { success: true, output };
          }
          
          case 'playback-state': {
            const result = await getPlaybackState(userToken);
            if (!result.success) {
              return result;
            }
            
            if (!result.state) {
              return { success: true, output: 'No active playback' };
            }
            
            const state = result.state;
            let output = 'Playback State:\n\n';
            
            if (state.item) {
              output += `Currently Playing: ${state.item.name}\n`;
              output += `Artist: ${state.item.artists.map((a: any) => a.name).join(', ')}\n`;
              output += `Album: ${state.item.album.name}\n`;
            }
            
            output += `\nStatus: ${state.is_playing ? '▶️ Playing' : '⏸️ Paused'}\n`;
            output += `Progress: ${Math.floor(state.progress_ms / 1000)}s / ${Math.floor(state.item?.duration_ms / 1000)}s\n`;
            output += `Shuffle: ${state.shuffle_state ? 'On' : 'Off'}\n`;
            output += `Repeat: ${state.repeat_state}\n`;
            output += `Volume: ${state.device?.volume_percent}%\n`;
            output += `Device: ${state.device?.name} (${state.device?.type})\n`;
            
            return { success: true, output };
          }
          
          case 'devices': {
            const result = await getDevices(userToken);
            if (!result.success) {
              return result;
            }
            
            if (!result.devices || result.devices.length === 0) {
              return { success: true, output: 'No devices found' };
            }
            
            let output = `Available devices (${result.devices.length}):\n\n`;
            result.devices.forEach((device: any, index: number) => {
              output += `${index + 1}. ${device.name}\n`;
              output += `   ID: ${device.id}\n`;
              output += `   Type: ${device.type}\n`;
              output += `   Active: ${device.is_active ? 'Yes' : 'No'}\n`;
              output += `   Volume: ${device.volume_percent}%\n\n`;
            });
            
            return { success: true, output };
          }
          
          case 'transfer': {
            if (!deviceId) {
              return { success: false, error: 'deviceId is required for transfer action' };
            }
            
            const result = await transferPlayback(deviceId, true, userToken);
            if (!result.success) {
              return result;
            }
            
            return { success: true, output: `✓ Transferred playback to device ${deviceId}` };
          }
          
          case 'seek': {
            if (position === undefined) {
              return { success: false, error: 'position (in milliseconds) is required for seek action' };
            }
            
            const result = await seekToPosition(position, userToken);
            if (!result.success) {
              return result;
            }
            
            return { success: true, output: `✓ Seeked to position ${position}ms` };
          }
          
          case 'repeat': {
            const result = await setRepeatMode(repeatMode, userToken);
            if (!result.success) {
              return result;
            }
            
            return { success: true, output: `✓ Set repeat mode to ${repeatMode}` };
          }
          
          case 'shuffle': {
            const result = await setShuffleMode(shuffleState, userToken);
            if (!result.success) {
              return result;
            }
            
            return { success: true, output: `✓ Set shuffle to ${shuffleState ? 'on' : 'off'}` };
          }
          
          case 'search-albums':
          case 'search-artists':
          case 'search-playlists':
          case 'search-shows':
          case 'search-episodes': {
            if (!query) {
              return {
                success: false,
                error: `Query is required for ${action}`
              };
            }
            
            // Map action to search type
            const typeMap: Record<string, string> = {
              'search-albums': 'album',
              'search-artists': 'artist',
              'search-playlists': 'playlist',
              'search-shows': 'show',
              'search-episodes': 'episode'
            };
            
            const searchTypes = [typeMap[action]];
            
            // Get access token
            let accessToken = userToken;
            if (!accessToken && clientId && clientSecret) {
              // Get client credentials token
              const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
              try {
                const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Basic ${credentials}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                  },
                  body: 'grant_type=client_credentials'
                });
                
                if (tokenResponse.ok) {
                  const tokenData = await tokenResponse.json() as SpotifyToken;
                  accessToken = tokenData.access_token;
                }
              } catch (error) {
                // Continue without token
              }
            }
            
            if (!accessToken) {
              // Try from settings
              try {
                const fs = await import('fs/promises');
                const path = await import('path');
                const os = await import('os');
                
                const settingsPath = path.join(os.homedir(), '.clanker', 'settings.json');
                const settingsData = await fs.readFile(settingsPath, 'utf-8');
                const settings = JSON.parse(settingsData);
                
                if (settings?.tools?.spotify?.clientId && settings?.tools?.spotify?.clientSecret) {
                  const credentials = Buffer.from(`${settings.tools.spotify.clientId}:${settings.tools.spotify.clientSecret}`).toString('base64');
                  const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
                    method: 'POST',
                    headers: {
                      'Authorization': `Basic ${credentials}`,
                      'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: 'grant_type=client_credentials'
                  });
                  
                  if (tokenResponse.ok) {
                    const tokenData = await tokenResponse.json() as SpotifyToken;
                    accessToken = tokenData.access_token;
                  }
                }
              } catch (error) {
                // Continue without token
              }
            }
            
            if (!accessToken) {
              return {
                success: false,
                error: 'Authentication required. Please provide credentials or run authorize action.'
              };
            }
            
            const result = await searchSpotify(query, searchTypes, limit, accessToken);
            if (!result.success) {
              return result;
            }
            
            let output = '';
            const type = typeMap[action];
            
            if (type === 'album' && result.results?.albums) {
              const albums = result.results.albums.items;
              output = `Found ${albums.length} albums:\n\n`;
              albums.forEach((album: any, index: number) => {
                output += `${index + 1}. ${album.name}\n`;
                output += `   Artist: ${album.artists.map((a: any) => a.name).join(', ')}\n`;
                output += `   Release: ${album.release_date}\n`;
                output += `   Tracks: ${album.total_tracks}\n`;
                output += `   ID: ${album.id}\n`;
                output += `   URL: ${album.external_urls.spotify}\n\n`;
              });
            } else if (type === 'artist' && result.results?.artists) {
              const artists = result.results.artists.items;
              output = `Found ${artists.length} artists:\n\n`;
              artists.forEach((artist: any, index: number) => {
                output += `${index + 1}. ${artist.name}\n`;
                output += `   Genres: ${artist.genres?.join(', ') || 'N/A'}\n`;
                output += `   Followers: ${artist.followers?.total?.toLocaleString() || 'N/A'}\n`;
                output += `   ID: ${artist.id}\n`;
                output += `   URL: ${artist.external_urls.spotify}\n\n`;
              });
            } else if (type === 'playlist' && result.results?.playlists) {
              const playlists = result.results.playlists.items;
              output = `Found ${playlists.length} playlists:\n\n`;
              playlists.forEach((playlist: any, index: number) => {
                output += `${index + 1}. ${playlist.name}\n`;
                output += `   Owner: ${playlist.owner.display_name}\n`;
                output += `   Tracks: ${playlist.tracks.total}\n`;
                if (playlist.description) {
                  output += `   Description: ${playlist.description}\n`;
                }
                output += `   ID: ${playlist.id}\n`;
                output += `   URL: ${playlist.external_urls.spotify}\n\n`;
              });
            } else if (type === 'show' && result.results?.shows) {
              const shows = result.results.shows.items;
              output = `Found ${shows.length} shows:\n\n`;
              shows.forEach((show: any, index: number) => {
                output += `${index + 1}. ${show.name}\n`;
                output += `   Publisher: ${show.publisher}\n`;
                if (show.description) {
                  output += `   Description: ${show.description.substring(0, 100)}...\n`;
                }
                output += `   ID: ${show.id}\n`;
                output += `   URL: ${show.external_urls.spotify}\n\n`;
              });
            } else if (type === 'episode' && result.results?.episodes) {
              const episodes = result.results.episodes.items;
              output = `Found ${episodes.length} episodes:\n\n`;
              episodes.forEach((episode: any, index: number) => {
                output += `${index + 1}. ${episode.name}\n`;
                output += `   Show: ${episode.show?.name || 'N/A'}\n`;
                output += `   Duration: ${Math.floor(episode.duration_ms / 60000)} min\n`;
                output += `   Release: ${episode.release_date}\n`;
                output += `   ID: ${episode.id}\n`;
                output += `   URL: ${episode.external_urls.spotify}\n\n`;
              });
            } else {
              output = 'No results found';
            }
            
            return { success: true, output };
          }
          
          case 'recommendations': {
            // Get access token
            let accessToken = userToken;
            if (!accessToken && clientId && clientSecret) {
              const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
              try {
                const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Basic ${credentials}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                  },
                  body: 'grant_type=client_credentials'
                });
                
                if (tokenResponse.ok) {
                  const tokenData = await tokenResponse.json() as SpotifyToken;
                  accessToken = tokenData.access_token;
                }
              } catch (error) {
                // Continue without token
              }
            }
            
            if (!accessToken) {
              // Try from settings
              try {
                const fs = await import('fs/promises');
                const path = await import('path');
                const os = await import('os');
                
                const settingsPath = path.join(os.homedir(), '.clanker', 'settings.json');
                const settingsData = await fs.readFile(settingsPath, 'utf-8');
                const settings = JSON.parse(settingsData);
                
                if (settings?.tools?.spotify?.clientId && settings?.tools?.spotify?.clientSecret) {
                  const credentials = Buffer.from(`${settings.tools.spotify.clientId}:${settings.tools.spotify.clientSecret}`).toString('base64');
                  const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
                    method: 'POST',
                    headers: {
                      'Authorization': `Basic ${credentials}`,
                      'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: 'grant_type=client_credentials'
                  });
                  
                  if (tokenResponse.ok) {
                    const tokenData = await tokenResponse.json() as SpotifyToken;
                    accessToken = tokenData.access_token;
                  }
                }
              } catch (error) {
                // Continue without token
              }
            }
            
            if (!accessToken) {
              return {
                success: false,
                error: 'Authentication required. Please provide credentials or run authorize action.'
              };
            }
            
            const tracks = seedTracks ? seedTracks.split(',').map((t: string) => t.trim()) : [];
            const artists = seedArtists ? seedArtists.split(',').map((a: string) => a.trim()) : [];
            const genres = seedGenres ? seedGenres.split(',').map((g: string) => g.trim()) : [];
            
            if (tracks.length === 0 && artists.length === 0 && genres.length === 0) {
              return {
                success: false,
                error: 'At least one seed (seedTracks, seedArtists, or seedGenres) is required for recommendations'
              };
            }
            
            const result = await getRecommendations(tracks, artists, genres, limit, accessToken);
            if (!result.success) {
              return result;
            }
            
            if (!result.tracks || result.tracks.length === 0) {
              return { success: true, output: 'No recommendations found' };
            }
            
            let output = `Recommendations (${result.tracks.length}):\n\n`;
            result.tracks.forEach((track: any, index: number) => {
              output += `${index + 1}. ${track.name}\n`;
              output += `   Artist: ${track.artists.map((a: any) => a.name).join(', ')}\n`;
              output += `   Album: ${track.album.name}\n`;
              output += `   ID: ${track.id}\n`;
              output += `   URI: ${track.uri}\n\n`;
            });
            
            return { success: true, output };
          }
          
          case 'new-releases': {
            // Get access token (similar to recommendations)
            let accessToken = userToken;
            if (!accessToken && clientId && clientSecret) {
              const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
              try {
                const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Basic ${credentials}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                  },
                  body: 'grant_type=client_credentials'
                });
                
                if (tokenResponse.ok) {
                  const tokenData = await tokenResponse.json() as SpotifyToken;
                  accessToken = tokenData.access_token;
                }
              } catch (error) {
                // Continue without token
              }
            }
            
            if (!accessToken) {
              // Try from settings
              try {
                const fs = await import('fs/promises');
                const path = await import('path');
                const os = await import('os');
                
                const settingsPath = path.join(os.homedir(), '.clanker', 'settings.json');
                const settingsData = await fs.readFile(settingsPath, 'utf-8');
                const settings = JSON.parse(settingsData);
                
                if (settings?.tools?.spotify?.clientId && settings?.tools?.spotify?.clientSecret) {
                  const credentials = Buffer.from(`${settings.tools.spotify.clientId}:${settings.tools.spotify.clientSecret}`).toString('base64');
                  const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
                    method: 'POST',
                    headers: {
                      'Authorization': `Basic ${credentials}`,
                      'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: 'grant_type=client_credentials'
                  });
                  
                  if (tokenResponse.ok) {
                    const tokenData = await tokenResponse.json() as SpotifyToken;
                    accessToken = tokenData.access_token;
                  }
                }
              } catch (error) {
                // Continue without token
              }
            }
            
            if (!accessToken) {
              return {
                success: false,
                error: 'Authentication required. Please provide credentials or run authorize action.'
              };
            }
            
            const result = await getNewReleases(limit, accessToken);
            if (!result.success) {
              return result;
            }
            
            if (!result.albums || result.albums.length === 0) {
              return { success: true, output: 'No new releases found' };
            }
            
            let output = `New Releases (${result.albums.length}):\n\n`;
            result.albums.forEach((album: any, index: number) => {
              output += `${index + 1}. ${album.name}\n`;
              output += `   Artist: ${album.artists.map((a: any) => a.name).join(', ')}\n`;
              output += `   Release Date: ${album.release_date}\n`;
              output += `   Total Tracks: ${album.total_tracks}\n`;
              output += `   ID: ${album.id}\n`;
              output += `   URL: ${album.external_urls.spotify}\n\n`;
            });
            
            return { success: true, output };
          }
          
          case 'featured-playlists': {
            // Get access token (similar to recommendations)
            let accessToken = userToken;
            if (!accessToken && clientId && clientSecret) {
              const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
              try {
                const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Basic ${credentials}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                  },
                  body: 'grant_type=client_credentials'
                });
                
                if (tokenResponse.ok) {
                  const tokenData = await tokenResponse.json() as SpotifyToken;
                  accessToken = tokenData.access_token;
                }
              } catch (error) {
                // Continue without token
              }
            }
            
            if (!accessToken) {
              // Try from settings
              try {
                const fs = await import('fs/promises');
                const path = await import('path');
                const os = await import('os');
                
                const settingsPath = path.join(os.homedir(), '.clanker', 'settings.json');
                const settingsData = await fs.readFile(settingsPath, 'utf-8');
                const settings = JSON.parse(settingsData);
                
                if (settings?.tools?.spotify?.clientId && settings?.tools?.spotify?.clientSecret) {
                  const credentials = Buffer.from(`${settings.tools.spotify.clientId}:${settings.tools.spotify.clientSecret}`).toString('base64');
                  const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
                    method: 'POST',
                    headers: {
                      'Authorization': `Basic ${credentials}`,
                      'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: 'grant_type=client_credentials'
                  });
                  
                  if (tokenResponse.ok) {
                    const tokenData = await tokenResponse.json() as SpotifyToken;
                    accessToken = tokenData.access_token;
                  }
                }
              } catch (error) {
                // Continue without token
              }
            }
            
            if (!accessToken) {
              return {
                success: false,
                error: 'Authentication required. Please provide credentials or run authorize action.'
              };
            }
            
            const result = await getFeaturedPlaylists(limit, accessToken);
            if (!result.success) {
              return result;
            }
            
            let output = '';
            if (result.message) {
              output += `${result.message}\n\n`;
            }
            
            if (!result.playlists || result.playlists.length === 0) {
              return { success: true, output: output + 'No featured playlists found' };
            }
            
            output += `Featured Playlists (${result.playlists.length}):\n\n`;
            result.playlists.forEach((playlist: any, index: number) => {
              output += `${index + 1}. ${playlist.name}\n`;
              if (playlist.description) {
                output += `   Description: ${playlist.description}\n`;
              }
              output += `   Owner: ${playlist.owner.display_name}\n`;
              output += `   Tracks: ${playlist.tracks.total}\n`;
              output += `   ID: ${playlist.id}\n`;
              output += `   URL: ${playlist.external_urls.spotify}\n\n`;
            });
            
            return { success: true, output };
          }
          
          case 'available-genres': {
            // Get access token (similar to recommendations)
            let accessToken = userToken;
            if (!accessToken && clientId && clientSecret) {
              const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
              try {
                const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Basic ${credentials}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                  },
                  body: 'grant_type=client_credentials'
                });
                
                if (tokenResponse.ok) {
                  const tokenData = await tokenResponse.json() as SpotifyToken;
                  accessToken = tokenData.access_token;
                }
              } catch (error) {
                // Continue without token
              }
            }
            
            if (!accessToken) {
              // Try from settings
              try {
                const fs = await import('fs/promises');
                const path = await import('path');
                const os = await import('os');
                
                const settingsPath = path.join(os.homedir(), '.clanker', 'settings.json');
                const settingsData = await fs.readFile(settingsPath, 'utf-8');
                const settings = JSON.parse(settingsData);
                
                if (settings?.tools?.spotify?.clientId && settings?.tools?.spotify?.clientSecret) {
                  const credentials = Buffer.from(`${settings.tools.spotify.clientId}:${settings.tools.spotify.clientSecret}`).toString('base64');
                  const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
                    method: 'POST',
                    headers: {
                      'Authorization': `Basic ${credentials}`,
                      'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: 'grant_type=client_credentials'
                  });
                  
                  if (tokenResponse.ok) {
                    const tokenData = await tokenResponse.json() as SpotifyToken;
                    accessToken = tokenData.access_token;
                  }
                }
              } catch (error) {
                // Continue without token
              }
            }
            
            if (!accessToken) {
              return {
                success: false,
                error: 'Authentication required. Please provide credentials or run authorize action.'
              };
            }
            
            const result = await getAvailableGenres(accessToken);
            if (!result.success) {
              return result;
            }
            
            if (!result.genres || result.genres.length === 0) {
              return { success: true, output: 'No genres found' };
            }
            
            let output = `Available Genre Seeds for Recommendations (${result.genres.length}):\n\n`;
            const columns = 4;
            const genresPerColumn = Math.ceil(result.genres.length / columns);
            
            for (let i = 0; i < genresPerColumn; i++) {
              let row = '';
              for (let j = 0; j < columns; j++) {
                const index = i + j * genresPerColumn;
                if (index < result.genres.length) {
                  row += result.genres[index].padEnd(20);
                }
              }
              output += row.trimEnd() + '\n';
            }
            
            output += '\n\nUse these genres with the recommendations action as seedGenres parameter.';
            
            return { success: true, output };
          }
          
          case 'audio-features': {
            if (!trackId) {
              return { success: false, error: 'trackId is required for audio-features action' };
            }
            
            // Get access token (similar to recommendations)
            let accessToken = userToken;
            if (!accessToken && clientId && clientSecret) {
              const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
              try {
                const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Basic ${credentials}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                  },
                  body: 'grant_type=client_credentials'
                });
                
                if (tokenResponse.ok) {
                  const tokenData = await tokenResponse.json() as SpotifyToken;
                  accessToken = tokenData.access_token;
                }
              } catch (error) {
                // Continue without token
              }
            }
            
            if (!accessToken) {
              // Try from settings
              try {
                const fs = await import('fs/promises');
                const path = await import('path');
                const os = await import('os');
                
                const settingsPath = path.join(os.homedir(), '.clanker', 'settings.json');
                const settingsData = await fs.readFile(settingsPath, 'utf-8');
                const settings = JSON.parse(settingsData);
                
                if (settings?.tools?.spotify?.clientId && settings?.tools?.spotify?.clientSecret) {
                  const credentials = Buffer.from(`${settings.tools.spotify.clientId}:${settings.tools.spotify.clientSecret}`).toString('base64');
                  const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
                    method: 'POST',
                    headers: {
                      'Authorization': `Basic ${credentials}`,
                      'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: 'grant_type=client_credentials'
                  });
                  
                  if (tokenResponse.ok) {
                    const tokenData = await tokenResponse.json() as SpotifyToken;
                    accessToken = tokenData.access_token;
                  }
                }
              } catch (error) {
                // Continue without token
              }
            }
            
            if (!accessToken) {
              return {
                success: false,
                error: 'Authentication required. Please provide credentials or run authorize action.'
              };
            }
            
            const result = await getAudioFeatures(trackId, accessToken);
            if (!result.success) {
              return result;
            }
            
            if (!result.features) {
              return { success: true, output: 'No audio features found' };
            }
            
            const f = result.features;
            let output = `Audio Features for Track ${trackId}:\n\n`;
            output += `Acousticness: ${(f.acousticness * 100).toFixed(1)}%\n`;
            output += `Danceability: ${(f.danceability * 100).toFixed(1)}%\n`;
            output += `Energy: ${(f.energy * 100).toFixed(1)}%\n`;
            output += `Instrumentalness: ${(f.instrumentalness * 100).toFixed(1)}%\n`;
            output += `Liveness: ${(f.liveness * 100).toFixed(1)}%\n`;
            output += `Speechiness: ${(f.speechiness * 100).toFixed(1)}%\n`;
            output += `Valence (Happiness): ${(f.valence * 100).toFixed(1)}%\n`;
            output += `\nLoudness: ${f.loudness} dB\n`;
            output += `Tempo: ${f.tempo} BPM\n`;
            output += `Key: ${['C', 'C♯/D♭', 'D', 'D♯/E♭', 'E', 'F', 'F♯/G♭', 'G', 'G♯/A♭', 'A', 'A♯/B♭', 'B'][f.key] || 'Unknown'}\n`;
            output += `Mode: ${f.mode === 1 ? 'Major' : 'Minor'}\n`;
            output += `Time Signature: ${f.time_signature}/4\n`;
            output += `Duration: ${Math.floor(f.duration_ms / 60000)}:${String(Math.floor((f.duration_ms % 60000) / 1000)).padStart(2, '0')}\n`;
            
            return { success: true, output };
          }
          
          default:
            return { success: false, error: `Unknown action: ${action}` };
        }
      }
      
      // Handle playback control actions
      if (['play', 'pause', 'next', 'previous', 'current', 'volume-up', 'volume-down'].includes(action)) {
        const result = await controlSpotify(action);
        return result;
      }
      
      // Handle search action
      if (!query) {
        return {
          success: false,
          error: 'Query is required for search action'
        };
      }
      // Try to get credentials from settings file if not provided
      if (!clientId || !clientSecret) {
        context.logger?.debug('No credentials provided as arguments, checking settings file...');
        
        // Load settings from file like elevenlabs does
        try {
          const fs = await import('fs/promises');
          const path = await import('path');
          const os = await import('os');
          
          const settingsPath = path.join(os.homedir(), '.clanker', 'settings.json');
          const settingsData = await fs.readFile(settingsPath, 'utf-8');
          const settings = JSON.parse(settingsData);
          
          // Access tools.spotify from settings
          const spotifySettings = settings?.tools?.spotify;
          
          if (spotifySettings) {
            if (spotifySettings.clientId && !clientId) {
              clientId = spotifySettings.clientId;
              context.logger?.debug('Found clientId from settings file');
            }
            if (spotifySettings.clientSecret && !clientSecret) {
              clientSecret = spotifySettings.clientSecret;
              context.logger?.debug('Found clientSecret from settings file');
            }
          }
        } catch (error) {
          context.logger?.debug('Could not read settings file:', error);
        }
        
        context.logger?.debug(`Final credentials - clientId: ${clientId ? 'present' : 'missing'}, clientSecret: ${clientSecret ? 'present' : 'missing'}`);
      }
      
      let accessToken: string | null = null;
      
      // Get access token if credentials provided
      if (clientId && clientSecret) {
        context.logger?.debug('Authenticating with Spotify API');
        
        const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        
        try {
          const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
              'Authorization': `Basic ${credentials}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: 'grant_type=client_credentials'
          });
          
          if (!tokenResponse.ok) {
            const error: any = await tokenResponse.json();
            throw new Error(error.error_description || 'Authentication failed');
          }
          
          const tokenData = await tokenResponse.json() as SpotifyToken;
          accessToken = tokenData.access_token;
          context.logger?.info('Successfully authenticated with Spotify');
        } catch (error) {
          context.logger?.error('Failed to authenticate', error);
          return {
            success: false,
            error: `Failed to authenticate with Spotify API: ${error instanceof Error ? error.message : String(error)}`
          };
        }
      }
      
      // Search for tracks
      context.logger?.debug(`Searching for: ${query}`);
      
      const searchUrl = new URL('https://api.spotify.com/v1/search');
      searchUrl.searchParams.append('q', String(query));
      searchUrl.searchParams.append('type', 'track');
      searchUrl.searchParams.append('limit', Math.min(limit as number, 50).toString());
      
      const headers: Record<string, string> = {};
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }
      
      let searchResponse: SpotifySearchResult;
      
      try {
        const response = await fetch(searchUrl.toString(), {
          method: 'GET',
          headers
        });
        
        if (!response.ok) {
          if (response.status === 401 && !accessToken) {
            return {
              success: false,
              error: 'Spotify API requires authentication. Please provide clientId and clientSecret arguments.\n\n' +
                     'To get credentials:\n' +
                     '1. Visit https://developer.spotify.com/dashboard\n' +
                     '2. Create a new app\n' +
                     '3. Copy your Client ID and Client Secret'
            };
          }
          
          const errorResponse: any = await response.json();
          throw new Error(errorResponse.error?.message || `HTTP ${response.status}`);
        }
        
        searchResponse = await response.json() as SpotifySearchResult;
      } catch (error) {
        context.logger?.error('Search failed', error);
        return {
          success: false,
          error: `Failed to search Spotify: ${error instanceof Error ? error.message : String(error)}`
        };
      }
      
      const tracks = searchResponse.tracks?.items || [];
      
      if (tracks.length === 0) {
        return {
          success: false,
          error: `No tracks found for query: "${query}"`
        };
      }
      
      // Format results
      let output = `Found ${tracks.length} track${tracks.length !== 1 ? 's' : ''}:\n\n`;
      
      tracks.forEach((track, index) => {
        const artists = track.artists.map(a => a.name).join(', ');
        output += `${index + 1}. ${track.name}\n`;
        output += `   Artist: ${artists}\n`;
        output += `   Album: ${track.album.name}\n`;
        output += `   ID: ${track.id}\n`;
        output += `   URI: ${track.uri}\n`;
        
        if (showUrl) {
          output += `   URL: ${track.external_urls.spotify}\n`;
        }
        
        if (index < tracks.length - 1) {
          output += '\n';
        }
      });
      
      // Open first result if requested
      if (openFirst && tracks.length > 0) {
        const firstTrack = tracks[0];
        const spotifyUri = firstTrack.uri;
        
        output += `\n\nOpening "${firstTrack.name}" by ${firstTrack.artists[0].name} in Spotify...`;
        
        try {
          // First pause any currently playing track to avoid overlap
          const pauseResult = await controlSpotify('pause');
          if (pauseResult.success) {
            output += '\n✓ Paused current playback';
          }
          
          // Open the new track
          await openUrl(spotifyUri);
          output += '\n✓ Opened in Spotify app';
          
          // Give Spotify a moment to load the track, then play it
          await new Promise(resolve => setTimeout(resolve, 1500));
          const playResult = await controlSpotify('play');
          if (playResult.success) {
            output += '\n✓ Started playback';
          }
        } catch (error) {
          try {
            await openUrl(firstTrack.external_urls.spotify);
            output += '\n✓ Opened in web browser';
          } catch (webError) {
            output += '\n✗ Failed to open Spotify';
          }
        }
      } else if (!openFirst && tracks.length > 0) {
        output += '\n\nTo play a track, copy its URI and paste in Spotify search bar';
        output += '\nor use --openFirst flag to auto-open the first result';
      }
      
      return {
        success: true,
        output,
        data: {
          trackCount: tracks.length,
          tracks: tracks.map(t => ({
            name: t.name,
            artist: t.artists[0]?.name,
            uri: t.uri
          }))
        }
      };
      
    } catch (error) {
      context.logger?.error('Unexpected error', error);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  })
  
  .examples([
    // Search examples
    {
      description: 'Search for a song',
      arguments: {
        action: 'search',
        query: 'Bohemian Rhapsody Queen'
      }
    },
    {
      description: 'Search for albums',
      arguments: {
        action: 'search-albums',
        query: 'Dark Side of the Moon'
      }
    },
    {
      description: 'Search for artists',
      arguments: {
        action: 'search-artists',
        query: 'Pink Floyd'
      }
    },
    {
      description: 'Search for playlists',
      arguments: {
        action: 'search-playlists',
        query: 'Workout Mix'
      }
    },
    // Playback control
    {
      description: 'Pause Spotify playback',
      arguments: {
        action: 'pause'
      }
    },
    {
      description: 'Resume Spotify playback',
      arguments: {
        action: 'play'
      }
    },
    {
      description: 'Skip to next track',
      arguments: {
        action: 'next'
      }
    },
    {
      description: 'Get playback state',
      arguments: {
        action: 'playback-state'
      }
    },
    {
      description: 'Seek to position (30 seconds)',
      arguments: {
        action: 'seek',
        position: 30000
      }
    },
    {
      description: 'Set repeat mode',
      arguments: {
        action: 'repeat',
        repeatMode: 'track'
      }
    },
    {
      description: 'Enable shuffle',
      arguments: {
        action: 'shuffle',
        shuffleState: true
      }
    },
    // Queue management
    {
      description: 'View current queue',
      arguments: {
        action: 'queue'
      }
    },
    {
      description: 'Add track to queue',
      arguments: {
        action: 'add-to-queue',
        trackUri: 'spotify:track:3n3Ppam7vgaVa1iaRUc9Lp'
      }
    },
    {
      description: 'Clear entire queue',
      arguments: {
        action: 'clear-queue'
      }
    },
    // Library management
    {
      description: 'Like/save a track',
      arguments: {
        action: 'like',
        trackId: '3n3Ppam7vgaVa1iaRUc9Lp'
      }
    },
    {
      description: 'Unlike/remove a track',
      arguments: {
        action: 'unlike',
        trackId: '3n3Ppam7vgaVa1iaRUc9Lp'
      }
    },
    {
      description: 'Check if tracks are saved',
      arguments: {
        action: 'check-saved',
        trackId: '3n3Ppam7vgaVa1iaRUc9Lp,4cOdK2wGLETKBW3PvgPWqT'
      }
    },
    {
      description: 'Get saved tracks',
      arguments: {
        action: 'saved-tracks',
        limit: 20
      }
    },
    // Playlist management
    {
      description: 'Get user playlists',
      arguments: {
        action: 'playlists'
      }
    },
    {
      description: 'Get playlist tracks',
      arguments: {
        action: 'playlist-tracks',
        playlistId: 'your_playlist_id'
      }
    },
    {
      description: 'Create a new playlist',
      arguments: {
        action: 'create-playlist',
        playlistName: 'My Awesome Playlist',
        playlistDescription: 'Songs I love'
      }
    },
    {
      description: 'Add tracks to playlist',
      arguments: {
        action: 'add-to-playlist',
        playlistId: 'your_playlist_id',
        trackUri: 'spotify:track:3n3Ppam7vgaVa1iaRUc9Lp,spotify:track:4cOdK2wGLETKBW3PvgPWqT'
      }
    },
    {
      description: 'Remove tracks from playlist',
      arguments: {
        action: 'remove-from-playlist',
        playlistId: 'your_playlist_id',
        trackUri: 'spotify:track:3n3Ppam7vgaVa1iaRUc9Lp'
      }
    },
    // User profile
    {
      description: 'Get recently played',
      arguments: {
        action: 'recently-played',
        limit: 10
      }
    },
    {
      description: 'Get top tracks',
      arguments: {
        action: 'top-tracks',
        limit: 10,
        timeRange: 'short_term'
      }
    },
    {
      description: 'Get top artists',
      arguments: {
        action: 'top-artists',
        limit: 10,
        timeRange: 'medium_term'
      }
    },
    // Device management
    {
      description: 'Get available devices',
      arguments: {
        action: 'devices'
      }
    },
    {
      description: 'Transfer playback to device',
      arguments: {
        action: 'transfer',
        deviceId: 'your_device_id'
      }
    },
    // Discovery & Recommendations
    {
      description: 'Get recommendations based on track',
      arguments: {
        action: 'recommendations',
        seedTracks: '3n3Ppam7vgaVa1iaRUc9Lp',
        limit: 10
      }
    },
    {
      description: 'Get recommendations based on genre',
      arguments: {
        action: 'recommendations',
        seedGenres: 'rock,indie',
        limit: 10
      }
    },
    {
      description: 'Get new album releases',
      arguments: {
        action: 'new-releases',
        limit: 10
      }
    },
    {
      description: 'Get featured playlists',
      arguments: {
        action: 'featured-playlists',
        limit: 10
      }
    },
    {
      description: 'Get available genre seeds',
      arguments: {
        action: 'available-genres'
      }
    },
    {
      description: 'Get audio features for a track',
      arguments: {
        action: 'audio-features',
        trackId: '3n3Ppam7vgaVa1iaRUc9Lp'
      }
    },
    // Authorization
    {
      description: 'Authorize Spotify for user actions',
      arguments: {
        action: 'authorize'
      }
    }
  ])
  
  .build();