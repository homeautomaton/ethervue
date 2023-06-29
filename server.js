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

//       x enable a/b/c/d buttons for cam selection
//         improve UI of TV app, for configuring address and port
//         move content of .currentView to cookie
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

let currentView = '1';
let width = 1920;
let height = 1080;
let view_map = {};     // name to position
let view_sort = [];    // sorted by key
let view_keys = {};    // key index into sorted list
let views = {};
let config = {};
let streams = [];

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
        // terrible n-squared algo here. not expecting a lot of variables, nor many with substitutions
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

        var_map[ 'hscale' ] = x / scalefactor;
        var_map[ 'vscale' ] = y / scalefactor;

        for ( let v in var_map ) {
            re = replre( '{{' + v + '}}' );
            sources[s].source = sources[s].source.replace( re, var_map[ v ] );
        }
        if ( var_map.key !== undefined )
            results.push( { "source" : sources[s].source, "var_map" : {...var_map} } );
    }
    return results;
}

config = readConfig();
readViews();

function readViews() {
    for ( let v of config.views ) {
        views[ v.name ] = v;
        if (v.key !== undefined) view_map[ v.key ] = v.name;
    }
    view_sort = Object.keys(view_map);
    for ( var i = 0; i < view_sort.length; i += 1 ) 
        view_keys[ view_sort[ i ] ] = i;
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
    return Math.ceil(Math.sqrt(views[view_map[currentView]].gallery.length)) ** 2;
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
                  onClientClose : clientClose
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

app.get('/sel', async (req, res) => {
  const view = req.query.view;

  if (view) {
    currentView = view;
  }
  const width0 = req.query.width;
  if (width0) {
    width = width0;
  }
  const height0 = req.query.height;
  if (height0) {
    height = height0;
  }
  saveCurrentView();
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
  config = readConfig();
  readViews();
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

app.listen(3004);
