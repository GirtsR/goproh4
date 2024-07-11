const GoPro = require('../../lib/index.js');

const cam = new GoPro.Camera();

const express = require('express');
const childProcess = require('child_process');

const start_ngrok = function () {
    if (typeof process.env.NGROK_AUTHTOKEN === "undefined") {
        throw new Error("NGROK_AUTHTOKEN env var is not defined");
    }
    console.log("Launching ngrok tunnels..");
    const ngrok = childProcess.spawn("ngrok", [
        "start", "--all", "--config", "ngrok.yml", "--authtoken", process.env.NGROK_AUTHTOKEN
    ]);
    ngrok.on("error", function (error) {
        process.exit(-1);
    });
    ngrok.on("exit", function (code) {
        if (code !== 0) {
            console.log(`ngrok exited with non-zero exit code: ${code}`);
            process.exit(code);
        }
    })
    ngrok.stdout.pipe(process.stdout);
    ngrok.stderr.pipe(process.stdout);
}

cam.restartStream().then(function () {
    console.log('[livestream]', 'started');

    start_ngrok();

    var STREAM_PORT =           8082;
    var WEBSOCKET_PORT =        8084;
    var STREAM_MAGIC_BYTES =    'jsmp';
    var width =                 432;
    var height =                240;

    var socketServer = new (require('ws').Server)({port: WEBSOCKET_PORT});

    socketServer.on('connection', function(socket) {
        var streamHeader = Buffer.alloc(8);
        streamHeader.write(STREAM_MAGIC_BYTES);
        streamHeader.writeUInt16BE(width, 4);
        streamHeader.writeUInt16BE(height, 6);
        socket.send(streamHeader, {binary:true});

        console.log( 'New WebSocket Connection ('+socketServer.clients.length+' total)' );

        socket.on('close', function(code, message){
            console.log( 'Disconnected WebSocket ('+socketServer.clients.length+' total)' );
        });
    });

    socketServer.broadcast = function(data, opts) {
        for( var i in this.clients ) {
            if (this.clients[i].readyState == 1) {
                this.clients[i].send(data, opts);
            }
            else {
                console.log( 'Error: Client ('+i+') not connected.' );
            }
        }
    };

    var app = express();

    app.post('/publish', function (req, res) {
        console.log(
            'Stream Connected: ' + req.socket.remoteAddress +
            ':' + req.socket.remotePort + ' size: ' + width + 'x' + height
        );
        req.socket.setTimeout(0);
        req.on('data', function(data){
            socketServer.broadcast(data, {binary:true});
        });
    });

    app.use('/index', express.static(__dirname + '/client'));

    app.listen(STREAM_PORT);

    var spawn_process = function () {
        var ffmpeg = childProcess.spawn("ffmpeg", [
		"-f",
		"mpegts",
		"-i",
		"udp://" + cam._ip + ":8554",
		"-f",
		"mpeg1video",
		"-b",
		"800k",
		"-r",
        "30",
        "http://127.0.0.1:8082/publish"
		]);

        ffmpeg.stdout.pipe(process.stdout);
        ffmpeg.stderr.pipe(process.stdout);
        ffmpeg.on('exit', function () {
            spawn_process();
        });
    };
    spawn_process();
});
