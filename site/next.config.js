/** @type {import('next').NextConfig} */
module.exports = {
  async headers() {
    return [
      { source: '/(.*)', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
    ]
  },
}
