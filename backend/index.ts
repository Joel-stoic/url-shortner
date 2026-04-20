import 'dotenv/config'
import express from 'express'
import type { Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { connectRedis, redisClient } from './config/redis.js'
import { nanoid } from 'nanoid'

const app = express()

// ✅ safer env check
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing")
}

// ✅ Prisma with adapter
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL 
})
const prisma = new PrismaClient({ adapter })

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

app.use(express.json())

// --------------------
// CACHE
// --------------------
const memoryCache = new Map<string, string>()
const MAX_CACHE_SIZE = 10000

function setMemoryCache(key: string, value: string) {
  if (memoryCache.size >= MAX_CACHE_SIZE) {
    const firstKey = memoryCache.keys().next().value
    if (firstKey) memoryCache.delete(firstKey)
  }
  memoryCache.set(key, value)
}

// --------------------
// REQUEST DEDUP
// --------------------
const pending = new Map<string, Promise<string | null>>()

async function getFromDB(code: string): Promise<string | null> {
  if (pending.has(code)) return pending.get(code)!

  const promise = prisma.url
    .findUnique({ where: { shortCode: code } })
    .then(res => res?.originalUrl || null)

  pending.set(code, promise)

  try {
    return await promise
  } finally {
    pending.delete(code)
  }
}

// --------------------
// URL VALIDATION
// --------------------
function isValidUrl(url: string) {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

// --------------------
// CREATE
// --------------------
app.post('/shorten', async (req: Request, res: Response) => {
  try {
    const { originalUrl } = req.body

    if (!originalUrl || typeof originalUrl !== 'string' || !isValidUrl(originalUrl)) {
      return res.status(400).json({ message: 'Invalid URL' })
    }

    let created = null

    for (let i = 0; i < 3; i++) {
      const shortCode = nanoid(6)

      try {
        created = await prisma.url.create({
          data: { originalUrl, shortCode }
        })
        break
      } catch (err: any) {
        if (err.code !== 'P2002') throw err
      }
    }

    if (!created) {
      return res.status(500).json({ message: 'Failed to generate short URL' })
    }

    return res.status(201).json({
      shortUrl: `${BASE_URL}/${created.shortCode}`
    })
  } catch (err) {
    console.error("CREATE ERROR:", err)
    return res.status(500).json({ message: 'Server error' })
  }
})

// --------------------
// REDIRECT
// --------------------
app.get('/:code', async (req: Request, res: Response) => {
  try {
    const code = req.params.code as string
    const cacheKey = `url:${code}`

    // 1. MEMORY
    const memoryHit = memoryCache.get(code)
    if (memoryHit) return res.redirect(memoryHit)

    // 2. REDIS
    let redisHit: string | null = null
    try {
      redisHit = await Promise.race([
        redisClient.get(cacheKey),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('Redis timeout')), 200)
        )
      ])
    } catch {}

    if (redisHit) {
      setMemoryCache(code, redisHit)
      return res.redirect(redisHit)
    }

    // 3. DB
    let originalUrl: string | null = null
    try {
      originalUrl = await Promise.race([
        getFromDB(code),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('DB timeout')), 400)
        )
      ])
    } catch {
      return res.status(504).json({ message: 'Timeout' })
    }

    if (!originalUrl) {
      return res.status(404).json({ message: 'Not found' })
    }

    // cache
    setMemoryCache(code, originalUrl)
    await redisClient.set(cacheKey, originalUrl, { EX: 86400 })

    return res.redirect(originalUrl)
  } catch (err) {
    console.error("REDIRECT ERROR:", err)
    return res.status(500).json({ message: 'Server error' })
  }
})

// --------------------
app.listen(3000, async() => {
  await connectRedis()
  console.log(`🚀 Server running on ${BASE_URL}`)
})