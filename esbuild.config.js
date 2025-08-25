export default {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  external: [
    '@ziggler/clanker',
    'react',
    'ink',
    'open'  // Mark open as external since it's a runtime dependency
  ],
  outfile: 'dist/index.js'
};