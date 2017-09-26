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
const os = require('os')
const bodyLimit = 50e6

if (cluster.isMaster) {
  let exit = false
  cluster.fork()

  cluster.on('disconnect', function (worker) {
    console.log('forking')
    if (!exit) {
      cluster.fork()
    }
  })

  process.on("SIGINT", () => {
    console.log('exiting worker')
    exit = true
    setTimeout(() => process.exit(), 5000)
  })

  console.log('master process running as ' + process.pid)
} else {
  let exit = false

  process.on("SIGINT", () => {
    exit = true
  })

  process.on('uncaughtException', (err) => {
    console.error(err)
    fs.appendFileSync('err.txt', os.EOL + new Date() + ' ' + err.stack)
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
    const timeout = 20000

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
      (cb) => {
        let handled = false
        let child

        let timeoutId = setTimeout(() => {
          if (handled) {
            return
          }

          handled = true

          if (child) {
            child.kill()
          }

          cb(new Error(`wkhtmltopdf timeout error, no result after ${timeout}ms`))
        }, timeout)

        child = execFile('wkhtmltopdf.exe', opts.args, (err) => {
          if (handled) {
            return
          }

          handled = true
          clearTimeout(timeoutId)

          if (err) {
            return cb(err)
          }

          cb()
        })
      }], (err) => {
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

    const reaper = new Reaper({ threshold: 180000 })

    reaper.watch(tmpDir)

    reaper.start((err, files) => { })

    setInterval(() => {
      reaper.start((err, files) => { })
    }, 30000 /* check every 30s for old files */).unref()
  }

  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/plain')
      return res.end(exit ? 'EXIT' : 'OK')
    }

    var data = []
    req.on('data', function (chunk) {
      data.push(chunk)

      if (data.length > bodyLimit) {
        console.log('Input request exceeded bodyLimit')
        fs.appendFileSync('err.txt', os.EOL + new Date() + ' Input request exceeded bodyLimit: ' + Buffer.concat(data).toString().substring(0, 100))
        res.writeHead(500)
        res.end('Input request exceeded bodyLimit')
        res.destroy()
      }
    })

    req.on('end', function () {
      if (res.finished) {
        return
      }

      let json
      try {
        data = Buffer.concat(data).toString()
        json = JSON.parse(data)
      } catch (e) {
        console.log('Invalid json send to the windows worker')
        fs.appendFileSync('err.txt', os.EOL + new Date() + ' Invalid json send to the windows worker: ' + data.substring(0, Math.min(1000, data.length)))
        res.writeHead(500)
        return res.end('Invalid json send to the windows worker')
      }

      const opts = json.data

      if (opts.recipe === 'wkhtmltopdf') {
        console.log('running wkhtmltopdf')
        return wkhtmltopdf(opts, req, res)
      }

      console.log('running phantom')
      return phantom(opts, req, res)
    })
  })

  reaper()
  server.listen(process.env.PORT || 80)
  console.log('listening on ' + process.env.PORT || 80)
}
