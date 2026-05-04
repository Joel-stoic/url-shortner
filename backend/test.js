import http from 'k6/http'

export const options = {
  vus: 100,
  duration: '1m',
}

const codes = ['8yu2yb', 'LuklGT', 'TO06Uq']

export default function () {
  const code = codes[Math.floor(Math.random() * codes.length)]

  if (Math.random() < 0.8) {
    // 80% reads (cache-friendly)
    http.get(`http://34.228.190.116:3000/${code}`, {
      redirects: 0,
    })
  } else {
    // 20% writes
    http.post(
      'http://34.228.190.116:3000/shorten',
      JSON.stringify({
        originalUrl: 'https://example.com/' + Math.random(),
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}