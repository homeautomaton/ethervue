const express = require('express');
const cors = require('cors');
const fs = require('fs');
const bodyParser = require('body-parser');
const mkdirp = require('mkdirp');
const { exec } = require('child_process');
const Stream = require('./index');


// TODO:   
//         default to no login, add option to enable
//         on-screen status/help display(s) in TV and web apps

//         enable a/b/c/d buttons for cam selection
//         improve UI of TV app, for configuring address and port
//         move content of .currentChannel to settings
//         let different clients stream different cams
//             persistent URLs(?)
//
//         AUDIO?
//         PTZ controls?
//         Templates, break out params like IP & PORT?

// To Document:
//         -vf:drawtext='fontsize=30:fontcolor=white:x=100:y=100:text=[`c`] %{localtime}'
//              `c` = channel, `n` = stream number, `t` = title


const {
  connectAuthentication, protect,
} = require('./authenticationConnection');

const app = express();
var inSaveStatus = false;

app.use(bodyParser.json({ limit: '50mb' }));
const corsOptions = {
  origin(o, callback) {
    callback(null, true);
  },
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  preflightContinue: true,
  credentials: true,
  maxAge: 3600,
};

let currentChannel = '1';
let width = 1920;
let height = 1080;
let view_map = {};
let views = {};
let config = {};
let streams = [];
let view_list = [];

app.use(cors(corsOptions));
// eslint-disable-next-line no-use-before-define
const connectionType = connectAuthentication(app, readConfig);

//console.log = () => {
//};
console.error = () => {
};
console.debug = () => {
};

function readConfig() {
  let channelJson = { channels: [] };
  const defaultChannelFile = './config/viewconfig.json';
  if (fs.existsSync(defaultChannelFile)) {
    const text = fs.readFileSync(defaultChannelFile, 'UTF-8');
    const defaultChannelJson = text ? JSON.parse(text) : {};
    defaultChannelJson.file = defaultChannelFile;
    channelJson = defaultChannelJson;
  }
  const ovverideChannelFile = `${process.env.HOME}/.ethervue/viewconfig.json`;
  if (fs.existsSync(ovverideChannelFile)) {
    const text = fs.readFileSync(ovverideChannelFile, 'UTF-8');
    const overrideChannel = text ? JSON.parse(text) : {};
    overrideChannel.file = ovverideChannelFile;
    channelJson = overrideChannel;
  }
  const channelsFile = '/opt/config/viewconfig.json';
  if (fs.existsSync(channelsFile)) {
    const text = fs.readFileSync(channelsFile, 'UTF-8');
    const overrideChannel = text ? JSON.parse(text) : {};
    overrideChannel.file = channelsFile;
    channelJson = overrideChannel;
  }
  if (!channelJson.ffmpeg) {
    channelJson.ffmpeg = {
      '-nostats': '',
      '-r': 31,
      '-loglevel': 'quiet',
      '-f': 'mpegts',
      '-codec:v': 'mpeg1video',
    };
  }
  if (!channelJson.ffmpeg['-codec:v']) {
    channelJson.ffmpeg['-codec:v'] = 'mpeg1video';
  }
  if (!channelJson.ffmpeg['-f']) {
    channelJson.ffmpeg['-f'] = 'mpegts';
  }
  if (!channelJson.ffmpeg['-r']) {
    channelJson.ffmpeg['-r'] = '32';
  }

  if (!channelJson.ffmpegPre) {
    channelJson.ffmpegPre = {};
  }
  if (!channelJson.transport) {
    channelJson.transport = 'udp';
  }
  if (channelJson.transport === 'tcp') {
    channelJson.ffmpegPre['-rtsp_transport'] = 'tcp';
  } else if (channelJson.transport === 'udp') {
    channelJson.ffmpegPre['-rtsp_transport'] = 'udp';
  } else if (channelJson.transport === 'none') {
    delete channelJson.ffmpegPre['-rtsp_transport'];
  }
  if (!channelJson.channels) {
    channelJson.channels = [];
  }
  channelJson.channels.forEach((channel) => {
    const ch = channel;
    if (!ch.ffmpeg) {
      ch.ffmpeg = {};
    }

    if (!ch.ffmpegPre) {
      ch.ffmpegPre = {};
    }
    if (ch.transport === 'tcp') {
      ch.ffmpegPre['-rtsp_transport'] = 'tcp';
    } else if (ch.transport === 'udp') {
      ch.ffmpegPre['-rtsp_transport'] = 'udp';
    } else if (ch.transport === 'none') {
      delete ch.ffmpegPre['-rtsp_transport'];
    }
  });
  if (!channelJson.users) {
    channelJson.users = [
      {
        userId: 0,
        username: 'admin',
        password: 'admin',
      },
    ];
  }
  channelJson.connectionType = connectionType;
  return channelJson;
}


function traverse_view( t, sources, vars, visited ) {
    visited[ t.name ] = 1;
    local_vars = {}
    for ( let v in t ) {
        if ( v != 'name' && v != 'gallery' )
           local_vars[ v ] = t[ v ];
    }
    vars.push( local_vars );
    for ( let g in t.gallery ) {
        more_vars = {}
        for ( let v in t.gallery[ g ] ) {
            if ( v != 'source' && v != 'view' )
               more_vars[ v ] = t.gallery[ g ][ v ];
        }
        vars.push( more_vars );
        if ( t.gallery[ g ].source ) {
            sources.push( {"source" : t.gallery[ g ].source, "vars" : {...vars} });
        }
        if ( t.gallery[ g ].view ) {
            traverse_view( views[ t.gallery[ g ].view ], sources, vars, visited );
        }
        vars.pop();
    }
    vars.pop();
}

function flatten_vars( vars ) {
    var_map = {}
    for ( let l in vars ) 
        for ( let v in vars[l] )
            if ( var_map[ v ] === undefined )
                var_map[ v ] = vars[ l ][ v ];
    for ( let v in config.defaults )
        if ( var_map[ v ] === undefined )
            var_map[ v ] = config.defaults[ v ];
    applied = true;
    while ( applied ) {
        applied = false;
        // terrible n-squared algo here. not expecting a lot of variables, nor many with substitutions
        for ( let v in var_map ) {
            if ( !var_map[v].includes( '{{' ) ) {
                s = '{{' + v + '}}';
                res = s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                var re = new RegExp(res, 'g');
                for ( let t in var_map ) {
                    if ( var_map[t].includes( s ) ) {
                        applied = true;
                        var_map[t] = var_map[t].replace(re, var_map[v] ); 
                    }
                }
            }
        }
    }
    return var_map;
}

function expand_view( v, x, y ) {
    sources = [];
    results = [];
    vars = [];
    visited = [];
    traverse_view( v, sources, vars, visited );
    let scalefactor = Math.sqrt( sources.length );
    for ( let s in sources ) {
        var_map = flatten_vars( sources[s].vars );
        var_map[ 'hscale' ] = x / scalefactor;
        var_map[ 'vscale' ] = y / scalefactor;
        for ( let v in var_map ) {
            res = '{{' + v + '}}';
            res = res.replace( /[-\/\\^$*+?.()|[\]{}]/g, '\\$&' );
            var re = new RegExp( res, 'g' );
            sources[s].source = sources[s].source.replace( re, var_map[ v ] );
        }
        if ( var_map.key !== undefined )
            results.push( sources[s].source );
    }
    return results;
}

config = readConfig();
readViews();

function readViews() {
    for ( let v of config.views ) {
        views[ v.name ] = v;
        if (v.key !== undefined) {
            view_map[ v.key ] = v.name;
        }
    }
    view_list = Object.keys(view_map);
}

let channels = config.channels;

function saveConfig() {
  streams.forEach(((stream) => {
    stream.mpeg1Muxer.stream.kill();
    //stream.wsServer.close();
    stream.stop();
  }));
  streams = [];
  const configFile = { ...config };
  delete configFile.file;
  let path = config.file;
  if (!config.file || config.file === './config/config.json') {
    mkdirp.sync(`${process.env.HOME}/.ethervue`);
    path = `${process.env.HOME}/.ethervue/viewconfig.json`;
  }
  fs.writeFileSync(path, JSON.stringify(configFile, null, 1), 'UTF-8');
  config = readConfig();
  channels = config.channels;
}

function readCurrentChannel() {
  const currentChannelFile = '.currentChannel';
  if (fs.existsSync(currentChannelFile)) {
    const curJson = JSON.parse(fs.readFileSync(currentChannelFile, 'UTF-8'));
    currentChannel = curJson.currentChannel;
    width = Number(curJson.width);
    height = Number(curJson.height);
  } else {
    currentChannel = '0';
    width = 1920;
    width = 1080;
  }
}

function saveCurrentChannel() {
  const currentChannelFile = '.currentChannel';
  fs.writeFileSync(currentChannelFile, JSON.stringify({ currentChannel, width, height }, null, 1));
}

function getMode() {
  let mode;
  if (view_map[currentChannel]) {
    mode = Math.ceil(Math.sqrt(views[view_map[currentChannel]].gallery.length)) ** 2;
  } else {
    mode = 1;
  }
  return mode;
}

readCurrentChannel();


function clientClose( stream ) {
  if ( stream.wsServer.clients.size == 0 ) {
    setTimeout(function () {
      if ( stream.wsServer.clients.size == 0 ) {
        stream.mpeg1Muxer.kill();
        stream.stop();
      }
    }, 2000);
  }
}

async function recreateStream() {
  streams.forEach(((stream) => {
    stream.mpeg1Muxer.kill();
    stream.stop();
  }));
  streams = [];
  const mode = getMode();
  readCurrentChannel();
  console.log('current channel is: ' + currentChannel);

  if (config.views) {
      if ( view_map[ currentChannel ] ) {
          view = expand_view( views[ view_map[ currentChannel ] ], width, height );
          for (var i = 0; i < view.length; i++) { // eslint-disable-line no-plusplus
              const stream = new Stream({
                name: `${currentChannel} ${i}`,
                cmd: view[i],
                wsPort: 9999 + i,
                onClientClose : clientClose
              });
              stream.mpeg1Muxer.on('exitWithError', () => {
                recreateStream();
              });
              stream.mpeg1Muxer.on('exitWithoutError', () => {
                recreateStream();
              });
              streams.push(stream);
          }
      }
      return;
  }
  if (currentChannel != 0 ) {
    const selectChannel = channels[currentChannel-1];
    for (let i = 0; i < mode; i++) { // eslint-disable-line no-plusplus
      if ((i === 0 && selectChannel.streamUrl) || selectChannel.streamUrl[i]) {
        let scalefactor = Math.sqrt(mode);

        const ffmpegPre = config.ffmpegPre ? config.ffmpegPre : {};
        const ffmpegPost = config.ffmpeg ? config.ffmpeg : {};
        const ffmpegPath = config.ffmpegPath ? config.ffmpegPath : "ffmpeg";
        const ffmpegChannelPre = selectChannel.ffmpegPre ? selectChannel.ffmpegPre : {};
        const ffmpegChannel = selectChannel.ffmpeg ? selectChannel.ffmpeg : {};
        const ffmpegPreOptions = {
          ...ffmpegPre,
          ...ffmpegChannelPre,
        };

        let ffmpegOptions = {
          ...{
            '-nostats': '',
            '-r': 33,
            '-loglevel': 'quiet',
          },
          ...ffmpegPost,
          ...ffmpegChannel,
          //...{
          //  '-vf': `scale=${width / scalefactor}:${height / scalefactor}`,
          //},
        };
        if (ffmpegOptions['-vf']) {
            ffmpegOptions['-vf'] = ffmpegOptions['-vf']
                                   .replace( '`c`', currentChannel )
                                   .replace( '`n`', i )
                                   .replace( '`t`', selectChannel.title )
            ffmpegOptions['-vf'] += ',' + `scale=${width / scalefactor}:${height / scalefactor}`
        } else {
            ffmpegOptions['-vf'] = `scale=${width / scalefactor}:${height / scalefactor}`
        }
        const stream = new Stream({
          name: `${currentChannel} ${i}`,
          streamUrl: Array.isArray(selectChannel.streamUrl)
            ? selectChannel.streamUrl[i] : selectChannel.streamUrl,
          wsPort: 9999 + i,
          onClientClose : clientClose,
          ffmpegOptions,
          ffmpegPreOptions,
          ffmpegPath,
        });
        stream.mpeg1Muxer.on('exitWithError', () => {
          recreateStream();
        });
        stream.mpeg1Muxer.on('exitWithoutError', () => {
          recreateStream();
        });
        streams.push(stream);
      }
    }
  }
}

recreateStream().then();

app.get('/lib.js', async (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const currentDir = path.dirname(__filename);
  const filePath = path.join(currentDir, 'lib.js');
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading file:', err);
      return;
    }
    return res.send(data);
  });
});

app.get('/next', async (req, res) => {
  const nextChannel = currentChannel + 1;
  const width0 = req.query.width;
  if (width0) {
    width = width0;
  }
  const height0 = req.query.height;
  if (height0) {
    height = height0;
  }
  if (nextChannel <= channels.length) {
    currentChannel = nextChannel;
  } else {
    currentChannel = 0;
  }
  saveCurrentChannel();
  await recreateStream();
  return res.send('OK');
});

app.get('/prev', async (req, res) => {
  const nextChannel = currentChannel - 1;
  const width0 = req.query.width;
  if (width0) {
    width = width0;
  }
  const height0 = req.query.height;
  if (height0) {
    height = height0;
  }
  if (nextChannel >= 0) {
    currentChannel = nextChannel;
  } else {
    currentChannel = channels.length;
  }
  saveCurrentChannel();
  await recreateStream();
  return res.send('OK');
});

app.get('/sel', async (req, res) => {
  const channel = req.query.channel;
  if (channel) {
    currentChannel = channel;
  }
  const width0 = req.query.width;
  if (width0) {
    width = width0;
  }
  const height0 = req.query.height;
  if (height0) {
    height = height0;
  }
  saveCurrentChannel();
  await recreateStream();
  return res.send('OK');
});

app.get('/reload', async (req, res) => {
  const width0 = req.query.width;
  if (width0) {
    width = width0;
  }
  const height0 = req.query.height;
  if (height0) {
    height = height0;
  }
  saveCurrentChannel();
  await recreateStream();
  return res.send('OK');
});

app.get('/info', cors(corsOptions), (req, res) => {
  readCurrentChannel();
  const mode = getMode();
  const currentTitle = views[ view_map[ currentChannel ] ].name;
  return res.send(JSON.stringify({
    mode,
    currentChannel,
    currentTitle,
  }));
});

app.use('/', protect(), express.static(`${__dirname}/camera-admin-ui/build`));

app.get('/admin/config/get', protect(), (req, res) => res.send(JSON.stringify({
  config,
})));

app.get('/admin/status/get', protect(), (req, res) => {
  readCurrentChannel();
  return res.send(JSON.stringify({
    currentChannel,
    width,
    height,
  }));
});

app.post('/admin/status/save', protect(), async (req, res) => {
  const newStatus = req.body;
  currentChannel = newStatus.currentChannel;
  saveCurrentChannel();
  readCurrentChannel();
  await recreateStream();
  return res.send(JSON.stringify({
    currentChannel,
    width,
    height,
  }));
});

app.post('/admin/config/save', protect(), async (req, res) => {
  const newConfig = req.body;
  if (newConfig.transport === 'tcp') {
    newConfig.ffmpegPre['-rtsp_transport'] = 'tcp';
  } else if (newConfig.transport === 'udp') {
    newConfig.ffmpegPre['-rtsp_transport'] = 'udp';
  } else if (newConfig.transport === 'none') {
    delete newConfig.ffmpegPre['-rtsp_transport'];
  }

  if (!newConfig.channels) {
    newConfig.channels = [];
  }
  newConfig.channels.forEach((channel) => {
    const ch = channel;
    if (ch.transport === 'tcp') {
      ch.ffmpegPre['-rtsp_transport'] = 'tcp';
    } else if (ch.transport === 'udp') {
      ch.ffmpegPre['-rtsp_transport'] = 'udp';
    } else if (ch.transport === 'none') {
      delete ch.ffmpegPre['-rtsp_transport'];
    }
  });
  config = { ...config, ...newConfig };
  saveConfig();
  await recreateStream();
  return res.send(JSON.stringify({
    config,
  }));
});

app.listen(3004);
