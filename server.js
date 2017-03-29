const http = require('http')
var toArray = require('stream-to-array')
const execFile = require('child_process').execFile
const fs = require('fs')
const path = require('path')
const Reaper = require('reap')
const uuid = require('uuid').v1
const async = require('async')
const tmpDir = path.join(require('os').tmpdir(), 'jsreport')
const cluster = require('cluster')

if (cluster.isMaster) {
    cluster.fork()
    cluster.on('disconnect', function (worker) {
        console.log('forking')     
        cluster.fork()
    })

    return
}

process.on('uncaughtException', (err) => {
  console.error(err)
  fs.appendFileSync('err.txt', err.stack)  
  process.exit(1);
})

const conversion = require('phantom-html-to-pdf')({
  numberOfWorkers: 2,
  tmpDir: tmpDir
})

const exactMatch = /(phantomjs-exact-[-0-9]*)/

const resolvePhantomPath = (phantomPath) => {
  const match = exactMatch.exec(phantomPath)

  if (match && match.length === 2) {
    return require(match[1]).path
  }

  return require('phantomjs').path
}

const processPart = (opts, id, partName, cb) => {
  if (!opts[partName]) {
    return cb()
  }

  fs.writeFile(path.join(tmpDir, `${id}-${partName}.html`), opts[partName], (err) => {
    if (err) {
      return cb(err)
    }

    opts.args.push(`--${partName}`)
    opts.args.push(path.join(tmpDir, `${id}-${partName}.html`))
    cb()
  })
}

const wkhtmltopdf = (opts, req, res) => {
  const id = uuid()

  async.waterfall([
    (cb) => fs.writeFile(path.join(tmpDir, `${id}.html`), opts.html, cb),
    (cb) => processPart(opts, id, 'header-html', cb),
    (cb) => processPart(opts, id, 'footer-html', cb),
    (cb) => processPart(opts, id, 'cover', cb),
    (cb) => {
      opts.args.push(path.join(tmpDir, `${id}.html`))
      opts.args.push(path.join(tmpDir, `${id}.pdf`))
      console.log(opts.args)
      cb()
    },
    (cb) => execFile('wkhtmltopdf.exe', opts.args, cb)], (err) => {
      if (err) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        return res.end(JSON.stringify({
          error: {
            message: err.message,
            stack: err.stack
          }
        }))
      }

      const stream = fs.createReadStream(path.join(tmpDir, `${id}.pdf`))
      stream.pipe(res)
  })
}

const phantom = (opts, req, res) => {
  opts.phantomPath = resolvePhantomPath(opts.phantomPath)
  conversion(opts, (err, pdf) => {
    if (err) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')

      return res.end(JSON.stringify({
        error: {
          message: err.message,
          stack: err.stack
        }
      }))
    }

    toArray(pdf.stream, (err, arr) => {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')

      delete pdf.stream
      pdf.content = Buffer.concat(arr).toString('base64')
      res.end(JSON.stringify(pdf))
    })
  })
}

const reaper = () => {

  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir)
  }

  const reaper = new Reaper({threshold: 180000})

  reaper.watch(tmpDir)

  reaper.start((err, files) => {})

  setInterval(() => {
    reaper.start((err, files) => {})
  }, 30000 /* check every 30s for old files */).unref()
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET') {
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/plain')
    return res.end('OK')
  }

  var data = ''
  req.on('data', function (chunk) {
    data += chunk.toString()
  })

  req.on('end', function () {
    const opts = JSON.parse(data).data

    console.log('request... ' + opts.recipe)

    if (opts.recipe === 'wkhtmltopdf') {
      return wkhtmltopdf(opts, req, res)
    }

    return phantom(opts, req, res)
  })
})

reaper()
server.listen(process.env.port || 8000)

