const express = require('express');
const cors = require('cors');
const fs = require('fs');
const bodyParser = require('body-parser');
const mkdirp = require('mkdirp');
const { exec } = require('child_process');
const Stream = require('./index');
// const merge = require('lodash.merge');
var XMLHttpRequest = require('xmlhttprequest').XMLHttpRequest;

// TODO:   
//         default to no login, add option to enable
//         strip down Config.js, write instructions for templating
//         on-screen status/help display(s) in TV and web apps
//              info
//              guide
//              ch list
//              e-manual
//              menu

//         ptz presets set & recall
//         turn on/off OSD on camera
//         possible to scale movements according to zoom level?
//         set time on camera ex: param.cgi?cmd=setservertime&-time=2011.08.23.10.35.08&-timezone=Asia%2FHong_Kong&-dstmode=off
//         view images and video stored on SD

//         improve UI of TV app, for configuring address and port
//         move content of .currentView to cookie
//         let different clients stream different cams
//             persistent URLs(?), cookie?
//
//         fix OS compatibility in mpeg1muxer.js:
//             child_process.spawn("/bin/bash", [ "-c", this.cmd ], {
//
//       X open a (second) websocket for server to send status updates
//
//         ONVIF?
//
//         check out https://github.com/k-yle/rtsp-relay
//         also: ffmpeg -re -stream_loop -1   -rtsp_transport tcp -i rtsp://yourscameraorginalstream -c copy -acodec aac  -f rtsp rtsp://ipofyourmachine:8554/mystream
//         https://marcochiappetta.medium.com/how-to-stream-rtsp-on-the-web-using-web-sockets-and-canvas-d821b8f7171e
//         node-rtsp-stream
//         https://github.com/forart/HyMPS/blob/main/RTSP.md#--

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

let currentView = '1';
let width = 1920;
let height = 1080;
let view_map = {};     // name to position
let view_sort = [];    // sorted by key
let view_keys = {};    // key index into sorted list
let views = {};
let config = {};
let streams = [];
let controls = {};
let zoom = false;
let currentDisplay = '';
let htmlText = {};
let httpVars = {};
let intervals = [];

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
  let viewJSON = { views: [] };
  const defaultViewFile = './config/viewconfig.json';
  if (fs.existsSync(defaultViewFile)) {
    const text = fs.readFileSync(defaultViewFile, 'UTF-8');
    const defaultViewJson = text ? JSON.parse(text) : {};
    defaultViewJson.file = defaultViewFile;
    viewJSON = defaultViewJson;
  }
  const ovverideViewFile = `${process.env.HOME}/.ethervue/viewconfig.json`;
  if (fs.existsSync(ovverideViewFile)) {
    const text = fs.readFileSync(ovverideViewFile, 'UTF-8');
    const overrideView = text ? JSON.parse(text) : {};
    overrideView.file = ovverideViewFile;
    viewJSON = overrideView;
  }
  const viewsFile = '/opt/config/viewconfig.json';
  if (fs.existsSync(viewsFile)) {
    const text = fs.readFileSync(viewsFile, 'UTF-8');
    const overrideView = text ? JSON.parse(text) : {};
    overrideView.file = viewsFile;
    viewJSON = overrideView;
  }

  if (!viewJSON.users) {
    viewJSON.users = [
      {
        userId: 0,
        username: 'admin',
        password: 'admin',
      },
    ];
  }
  viewJSON.connectionType = connectionType;
  return viewJSON;
}

function traverse_view( t, sources, vars, visited ) {
    visited[ t.name ] = 1;
    local_vars = {}
    for ( let v in t ) {
        if ( v != 'name' && v != 'sources' )
           local_vars[ v ] = t[ v ];
    }
    vars.push( local_vars );
    for ( let g in t.sources ) {
        more_vars = {}
        for ( let v in t.sources[ g ] ) {
            if ( v != 'source' && v != 'view' )
               more_vars[ v ] = t.sources[ g ][ v ];
        }
        vars.push( more_vars );
        if ( t.sources[ g ].source ) {
            sources.push( {"source" : t.sources[ g ].source, "vars" : {...vars} });
        }
        if ( t.sources[ g ].view ) {
            traverse_view( views[ t.sources[ g ].view ], sources, vars, visited );
        }
        vars.pop();
    }
    vars.pop();
}

function replre( s ) {
    res = s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    return new RegExp(res, 'g');
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
        // terrible n-squared algo here. not expecting a lot of variables, nor many deeply nested substitutions
        for ( let v in var_map ) {
            if ( !var_map[v].includes( '{{' ) ) {
                s = '{{' + v + '}}';
                re = replre( s );
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

function expand_view( v, mode, x, y ) {
    sources = [];
    results = [];
    vars = [];
    visited = [];
    traverse_view( v, sources, vars, visited );
    let scalefactor = Math.sqrt( mode );

    for ( let s in sources ) {
        let var_map = flatten_vars( sources[s].vars );
        views[ view_map[ currentView ] ]

        var_map[ 'hscale' ] = x / scalefactor;
        var_map[ 'vscale' ] = y / scalefactor;
        var_map[ 'name' ] = v.name;

        for ( let v in var_map ) {
            re = replre( '{{' + v + '}}' );
            sources[s].source = sources[s].source.replace( re, var_map[ v ] );
        }
        if ( var_map.key !== undefined ) {
          if ( 'control' in var_map && var_map.control in controls ) {
            urls = {}
            for ( let c in controls[ var_map.control ] ) {
              if ( c != 'name' ) {
                urls[ c ] = controls[ var_map.control ][ c ];
                for ( let v in var_map ) {
                  re = replre( '{{' + v + '}}' );
                  urls[c] = urls[c].replace( re, var_map[ v ] );
                }
              }
            }
            var_map[ 'control' ] = {...urls};
          }
          results.push( { "source" : sources[s].source, "var_map" : {...var_map} } );
        }
    }
    return results;
}

config = readConfig();
processConfig();

function processConfig() {
    for ( let v of config.views ) {
        views[ v.name ] = v;
        if (v.key !== undefined) view_map[ v.key ] = v.name;
    }
    view_sort = Object.keys(view_map);
    for ( var i = 0; i < view_sort.length; i += 1 ) 
        view_keys[ view_sort[ i ] ] = i;
    for ( let c of config.controls ) {
        controls[ c.name ] = c;
    }
    for ( let t of config.text ) {
        htmlText[ t.name ] = t.frames;
    }
    for ( let p of config.vars ) {
        httpVars[ p.name ] = p;
    }
    setUpPolling();
}

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
}

function readCurrentView() {
  const currentViewFile = '.currentView';
  if (fs.existsSync(currentViewFile)) {
    const curJson = JSON.parse(fs.readFileSync(currentViewFile, 'UTF-8'));
    currentView = curJson.currentView;
    width = Number(curJson.width);
    height = Number(curJson.height);
  } else {
    currentView = '0';
    width = 1920;
    width = 1080;
  }
}

function saveCurrentView() {
  const currentViewFile = '.currentView';
  fs.writeFileSync(currentViewFile, JSON.stringify({ currentView, width, height }, null, 1));
}

function getMode() {
  if (view_map[currentView]) {
    if ( 'cycle-time' in views[view_map[currentView]] )
        return 1;
    return Math.ceil(Math.sqrt(views[view_map[currentView]].sources.length)) ** 2;
  } else {
    return 1;
  }
}

readCurrentView();


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

function newStream( options ) {
  const stream = new Stream(
      options
      );
  stream.mpeg1Muxer.on('exitWithError', () => {
    recreateStream();
  });
  stream.mpeg1Muxer.on('exitWithoutError', () => {
    recreateStream();
  });
  return stream;
}

async function recreateStream() {
  streams.forEach(((stream) => {
    stream.mpeg1Muxer.kill();
    stream.stop();
  }));
  streams = [];
  const mode = getMode();
  readCurrentView();
  console.log('current view is: ' + currentView);
  cmd = '';

  let exitCheck = "ppid=$(ps -o ppid= -p $$); if [ $ppid = '1' ]; then exit; fi; ".replace('$','$$$$');
  let cycleCmd = "while true; do {{cmd}} done";
  let cyclere = replre( "{{cmd}}" );
  let port = 9999

  if ( view_map[ currentView ] ) {
      console.log( mode + ' ' + width + ' ' + height );
      view = expand_view( views[ view_map[ currentView ] ], mode, width, height );
      for ( var i = 0; i < view.length; i += 1 ) {
          if ( 'cycle-cmd' in view[i].var_map ) cycleCmd = view[i].var_map[ 'cycle-cmd' ].replace('$','$$$$');
          if ( 'exit-check' in view[i].var_map ) exitCheck = view[i].var_map[ 'exit-check' ].replace('$','$$$$');
          if ( 'cycle-time' in view[i].var_map ) {
              cmd += view[i].source + '; ' + exitCheck
          } else {
              stream = newStream({
                  name: `${currentView} ${i}`,
                  cmd: view[i].source,
                  wsPort: port,
                  onClientClose : clientClose,
                  var_map: view[i].var_map
              } );
              streams.push(stream);
              port += 1;
          }
      }
      if ( cmd !== '' ) {
          streams.push( newStream({
                                    name: `${currentView}`,
                                    cmd: cycleCmd.replace( cyclere, cmd ),
                                    wsPort: port,
                                    onClientClose : clientClose 
                        } ) );
      }
  }
}

//recreateStream().then();

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
  if (req.query.width) width = req.query.width;
  if (req.query.height) height = req.query.height;

  if ( currentView == '0' )
    currentView = view_sort[ 0 ];
  else if ( view_keys[ currentView ] == view_sort.length - 1 )
    currentView = '0';
  else
    currentView = view_sort[ view_keys[ currentView ] + 1 ];

  saveCurrentView();
  await recreateStream();
  return res.send('OK');
});

app.get('/prev', async (req, res) => {
  if (req.query.width) width = req.query.width;
  if (req.query.height) height = req.query.height;

  if ( currentView == '0' )
    currentView = view_sort[ view_sort.length - 1 ];
  else if ( view_keys[ currentView ] == 0 )
    currentView = '0';
  else
    currentView = view_sort[ view_keys[ currentView ] - 1 ];

  saveCurrentView();
  await recreateStream();
  return res.send('OK');
});

app.get('/log', async (req, res) => {
  console.log( req.query.text );
  return res.send('OK');
});

function pollVariable( name, url ) {
  console.log('begin poll ');
  console.log(name);
  console.log(url);
  if ( url === undefined ) return;

  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.onreadystatechange = function () {
    if (xhr.readyState === xhr.DONE) {
      if (xhr.status !== 200) {
        console.log('There was a problem with the request. [' + xhr.status + ']');
      } else {
          console.log( name + ' = ' + xhr.responseText );
          httpVars[ name ].val = xhr.responseText;
      }
      delete xhr;
    }
  };
  xhr.onerror = function (e) {
    console.log(xhr.statusText);
    delete xhr;
  };
  xhr.send();
  return xhr;
}

function setUpPolling() {
    for ( let i in intervals ) {
        clearInterval( intervals[ i ] );
    }
    intervals = [];
    for ( let p in httpVars ) {
        console.log( httpVars[p].name );
        console.log( httpVars[p].url );
        console.log( httpVars[p].interval );
        if ( httpVars[p].url !== undefined && httpVars[p].interval > 0 ) {
            pollVariable( p, httpVars[p].url );
            let url = httpVars[p].url;
            inv = setInterval( function() { pollVariable( p, url ) }, httpVars[p].interval * 1000 );
            intervals.push(inv);
        }
    }
}

function dorequest( url, username, password ) {
  var xhr = new XMLHttpRequest();
  xhr.withCredentials = true;
  xhr.open('GET', url, true);
  xhr.setRequestHeader("Authorization", "Basic " + Buffer.from(username+':'+password, 'utf8').toString('base64'));
  xhr.onreadystatechange = function () {
    if (xhr.readyState === xhr.DONE) {
      if (xhr.status !== 200) {
        console.log('There was a problem with the request. [' + xhr.status + ']');
      }
    }
  };
  xhr.onerror = function (e) {
    console.log(xhr.statusText);
  };
  xhr.send();
  return xhr;
}

function pan( dir ) {
  if ( streams.length > 0 ) {
    dorequest( streams[ 0 ].options.var_map.control[ dir ],
               streams[ 0 ].options.var_map.username,
               streams[ 0 ].options.var_map.password );
  }
}

function get_view_list( ) {
    result = "";
    for ( let v in view_map ) {
        result += v + " " + views[ view_map[ v ] ].name + "<br>";
    }
    return result;
}

function expand_text( content ) {
    if ( streams.length > 0 ) {
        for ( let v in streams[ 0 ].options.var_map ) {
            re = replre( '{{' + v + '}}' );
            content = content.replace( re, streams[ 0 ].options.var_map[ v ] );
        }
    }
    for ( let p in httpVars ) {
        re = replre( '{{' + p + '}}' );
        content = content.replace( re, httpVars[ p ].val );
    }
    re = replre( '{{view-list}}' );
    content = content.replace( re, get_view_list() );
    return content;
}

app.get('/set', async (req, res, next) => {
    if ( req.query.val !== undefined ) {
        if ( req.query.var !== undefined && streams.length > 0 && req.query.var in streams[ 0 ].options.var_map ) {
            streams[ 0 ].options.var_map[ req.query.var ] = req.query.val;
        } else if ( req.query.var !== undefined ) {
            httpVars[ req.query.var ].val = req.query.val;
        } else {
            try {
                var tmp = JSON.parse( req.query.val );
                // merge( httpVars, tmp );
                for ( v in tmp ) {
                    if ( v in httpVars ) {
                        httpVars[ v ].val = tmp[ v ];
                    } else {
                        httpVars[ v ] = { "name" : v, "val" : tmp[ v ] };
                    }
                }
                console.log( JSON.stringify( httpVars ) );
            } catch ( err ) {
                console.log( err );
            }
        }
    }
    return res.send( "OK" );
});

app.get('/get', async (req, res, next) => {
    result = "";
    if ( req.query.var !== undefined ) {
        if ( streams.length > 0 && req.query.var in streams[ 0 ].options.var_map ) {
            result = streams[ 0 ].options.var_map[ req.query.var ];
        } else if ( req.query.var in httpVars ) {
            result = httpVars[ req.query.var ].val;
        }
    }
    return res.send( JSON.stringify( { result } ) );
});

app.get('/expand', async (req, res, next) => {
    result = "";
    if ( req.query.text !== undefined ) {
        result = expand_text( req.query.text );
    }
    return res.send( JSON.stringify( { result } ) );
});

app.get('/display', async (req, res, next) => {
  var key;
  try {
    if ( req.query.key !== undefined ) {
      switch( req.query.key) {
        case 'ChannelList':
        case 'c':
            key = 'ChannelList';
            break;
  
        case 'Info':
        case 'i':
            key = 'Info';
            break;
  
        case 'Menu':
        case 'm':
            key = 'Menu';
            break;
  
        case 'Guide':
        case 'g':
            key = 'Guide';
            break;
  
        case 'E-Manual':
        case 'e':
        case '?':
        case 'h':
            key = 'E-Manual';
            break;
      }
      if ( key !== undefined ) {
          if ( key == currentDisplay )
            currentFrame += 1;
          else
            currentFrame = 0;
          currentDisplay = key;
      }
    }
    let content;
    if ( htmlText[ currentDisplay ] ) {
        if ( currentFrame >= htmlText[ currentDisplay ].length ) {
           currentFrame = 0;
           currentDisplay = '';
           content = config.html;
        } else if ( htmlText[ currentDisplay ].length ) {
            content = htmlText[ currentDisplay ][ currentFrame ] + config.html;
        }
    } else
        content = config.html;

    let re;
    content = expand_text( content );

    return res.send( JSON.stringify( { content, currentDisplay } ) );
  } catch ( err ) {
    console.log( err );
    next( err );
  }
  content = '<B><CENTER><FONT SZ=+4>Define content for ' + key + ' in config</FONT></CENTER></B>' + config.html;
  return res.send( JSON.stringify( { content, currentDisplay } ) );
});

app.get('/keypress', async (req, res) => {
  try {
    switch( req.query.key ) {
      case 'Info':        // TV remote
        return res.send('OK');
      case 'Minus':       // TV remote A
      case 'Extra':       // TV remote B
        zoom = !zoom;
        break;
      case 'UpArrow':     // TV
        if ( zoom )
          pan( 'in' );
        else
          pan( 'up' );
        break;
      case 'ArrowUp':     // Browser
        pan( 'up' );
        break;
      case 'LeftArrow':   // TV
      case 'ArrowLeft':   // Browser
        pan( 'left' );
        break;
      case 'RightArrow':  // TV
      case 'ArrowRight':  // Browser
        pan( 'right' );
        break;
      case 'DownArrow':   // TV
        if ( zoom )
          pan( 'out' );
        else
          pan( 'down' );
        break;
      case 'ArrowDown':   // Browser
        pan( 'down' );
        break;
      default:
        console.log( 'key: ' + req.query.key );
    }
  }
  catch(err) { 
      console.log(err);
  }
  return res.send('OK');
});

app.get('/keyup', async (req, res) => {
  return res.send('OK');
});

app.get('/sel', async (req, res) => {
  const view = req.query.view;

  const width0 = req.query.width;
  if (width0) {
    width = width0;
  }
  const height0 = req.query.height;
  if (height0) {
    height = height0;
  }
  if (view && ( view in view_map || view == '0' )) {
    currentView = view;
    saveCurrentView();
    await recreateStream();
  }
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
  config = readConfig();
  processConfig();
  saveCurrentView();
  await recreateStream();
  return res.send('OK');
});

app.get('/info', cors(corsOptions), (req, res) => {
  readCurrentView();
  var currentTitle = 'OFF';
  var mode = 1;
  if ( currentView in view_map ) {
      currentTitle = views[ view_map[ currentView ] ].name;
      mode = getMode();
  }
  return res.send(JSON.stringify({
    mode,
    currentView,
    currentTitle,
  }));
});

app.use('/', protect(), express.static(`${__dirname}/camera-admin-ui/build`));

app.get('/admin/config/get', protect(), (req, res) => res.send(JSON.stringify({
  config,
})));

app.get('/admin/status/get', protect(), (req, res) => {
  readCurrentView();
  return res.send(JSON.stringify({
    currentView,
    width,
    height,
  }));
});

app.post('/admin/status/save', protect(), async (req, res) => {
  const newStatus = req.body;
  currentView = newStatus.currentView;
  saveCurrentView();
  readCurrentView();
  await recreateStream();
  return res.send(JSON.stringify({
    currentView,
    width,
    height,
  }));
});

app.post('/admin/config/save', protect(), async (req, res) => {
  const newConfig = req.body;
  config = { ...config, ...newConfig };
  saveConfig();
  await recreateStream();
  return res.send(JSON.stringify({
    config,
  }));
});


app.get('/sse', (req, res) => {
  console.log('A');
  res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
  });
  addSSEClient(req, res);
});

let clientData = [];
let sequence = 1;
function addSSEClient(req, res) {
    console.log('B');
    req.on('close', () =>  clientData = clientData.filter(o => o.res !== res));
    clientData.push({
        res,
        clientNo: sequence++,
        messageNo: 1
    });
}
function send() {
    clientData.forEach(o => {
        console.log('C');
        const data = JSON.stringify({
            clientCount: clientData.length,
            clientNo: o.clientNo,
            messageNo: o.messageNo++
        });
    o.res.write(`data: ${data}\n\n`);
    });
    setTimeout(send, 1000);
}

setTimeout(send);

app.listen(3004);
