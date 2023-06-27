var Mpeg1Muxer, child_process, events, util

child_process = require('child_process')

util = require('util')

events = require('events')

Mpeg1Muxer = function (options) {
    var key
    this.cmd = options.cmd
    this.exitCode = undefined
    this.signal = undefined
    this.killed = false;
    this.stream = child_process.spawn("/bin/bash", [ "-c", this.cmd ], {
        detached: false
    });
    this.kill=()=>{
        this.killed=true;
        this.stream.kill();
    }
    this.inputStreamStarted = true
    this.stream.stdout.on('data', (data) => {
        return this.emit('mpeg1data', data)
    })
    this.stream.stderr.on('data', (data) => {
        return this.emit('ffmpegStderr', data)
    })
    this.stream.on('error', (e) => {
         console.log('error spawning ffmpegPath: ' + e);
    })
    this.stream.on('exit', (code, signal) => {
        if (this.killed){
            return ;
        }
        if (code === 0) {
            return this.emit('exitWithoutError')
        } else {
            console.error('RTSP stream exited with error')
            this.exitCode = code
            this.signal = signal
            return this.emit('exitWithError')
        }
    })
    return this
}

util.inherits(Mpeg1Muxer, events.EventEmitter)

module.exports = Mpeg1Muxer
