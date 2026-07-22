/** @type {import('next').NextConfig} */
module.exports = {
  async rewrites() {
    return {
      beforeFiles: [
        // Serve the static marketing page at the root, keeping the "/" URL clean.
        { source: '/', destination: '/home.html' },
      ],
    }
  },
  async headers() {
    return [
      { source: '/(.*)', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
    ]
  },
}
