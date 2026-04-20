import http from 'k6/http'
import { sleep } from 'k6'

export const options = {
  vus: 300,
  duration: '1m',
}

const code=''

export default function () {
  const code = codes[Math.floor(Math.random() * codes.length)]

  http.get(`http://localhost:3000/${code}`, {
    redirects: 0
  })


}