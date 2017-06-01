'use strict';

var path = require('path');
var fs = require('fs');
var request = require('request');

var winServer = 'http://localhost';

var payload = {
  data: {
    html: '<h1>It works!</h1>',
    timeout: 8000
  }
};

console.log('SENDING REQUEST TO WINDOW WORKER..');

request.post({
  url: winServer,
  json: true,
  body: payload
}, function (err, httpResponse, body) {
  var saveTo = path.join(process.cwd(), 'output.pdf');

  if (err) {
    console.error('REQUEST TO WINDOW WORKER FAILED:', err.message);
    console.error(err);
    return;
  }

  console.log('WINDOW WORKER RESPONSE STATUS:', httpResponse.statusCode);

  if (!body) {
    return console.log('RESPONSE EMPTY!');
  }

  console.log('WINDOW WORKER RESPONSE BODY:')
  console.log(JSON.stringify(body, null, 2))

  console.log('SAVING WINDOW WORKER RESPONSE IN:', saveTo)

  fs.writeFile(saveTo, new Buffer(body.content, 'base64'), function (saveErr) {
    if (saveErr) {
      return console.error('ERROR WHILE SAVING THE OUTPUT:', saveErr)
    }

    console.log('REQUEST TO WINDOW WORKER COMPLETE!')
  })
});
