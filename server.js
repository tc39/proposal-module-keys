#!/usr/bin/env node

const http = require('http')
const serveStatic = require('serve-static')

const port = 8000
const origin = `http://localhost:${port}`

const staticServer = serveStatic(
  'examples',
  {
    setHeaders(res, path, stat) {
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Access-Control-Allow-Origin', origin)
    }
  })

const server = http.createServer(
  (req, res) => {
    staticServer(
      req, res,
      () => {
        res.writeHead(
          404,
          { Location: `${origin}/alice-bob-carol/index.html` })
        res.end()
      })
  })

server.listen(8000)

console.log(`Try ${origin}/alice-bob-carol/index.html`)
