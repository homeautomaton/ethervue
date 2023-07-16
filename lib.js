{ http: ( { 
queue : [],
loadExpected : false,
showKeys : false,
intervals : [],
currentDisplay : "",
buttonTimer : "",
eventStream : {},

establishSSE : ( function establishSSE( ) {
   lib.log('here 1');
   var url = 'http://' + serverInfo.ip + ':3004/sse';
   lib.log('here 2');
   lib.eventStream= new EventSource(url);
   lib.log('here 3');
   lib.eventStream.onmessage =  (e)=> {
         lib.log('here 5');
         const data = JSON.parse(e.data);
         lib.log(data);
   };
   lib.log('here 4');
} ),

key : ( function key( k ) {
    k = k.toString();
    if ( lib.showKeys ) notice.innerHTML = k;
    if ( k.length == 1 && ( k >= '0' && k <= '9' || k >= 'A' && k <= 'D' ) ) {
      lib.sel( k );
      return;
    }
    switch ( k ) {
      case 'Channel+': // TV
      case '+':        // Browser
        lib.next();
        break;
      case 'Channel-': // TV
      case '-':        // Browser
        lib.prev();
        break;
      case 'MediaPlay':
        notice.innerHTML='Reload';
        reload();
        break;
      case 'PreviousChannel':
        notice.innerHTML='Refresh';
        location.reload();
        break;
      case 'Info':     // TV
      case 'Menu':
      case 'Guide':
      case 'ChannelList':
      case 'E-Manual':
      case 'i':        // Browser
      case 'e':
      case '?':
      case 'h':
      case 'm':
      case 'g':
      case 'c':
        lib.display( k );
        break;

      case 's':
        lib.establishSSE();
        break;

    // Browser
      case 'Escape':
        notice.innerHTML = 'Reload';
        reload();
        break;
      case 'r':
        notice.innerHTML = 'Refresh';
        location.reload();
        break;
      case 'f':
        notice.innerHTML = 'Fullscreen';
        lib.fullScreen();
        break;
      case '|':
        lib.showKeys = ! lib.showKeys;
        break;

      default:
        lib.keypress( k );
        break;
    }
} ),

req : ( function req( path ) {
  var xhr = new XMLHttpRequest();
  var url = 'http://' + serverInfo.ip + ':' + serverInfo.port + path;
  xhr.withCredentials = true;
  xhr.open('GET', url, true);
  return xhr;
} ),

dorequest : ( function dorequest( path, reload, callback ) {
  var xhr = lib.req( path );
  xhr.onreadystatechange = function () {
    if (xhr.readyState === xhr.DONE) {
      if (xhr.status === 200) {
        if ( callback ) callback( xhr.responseText );
        if ( reload ) location.reload();
      } else {
        console.log('There was a problem with the request.');
      }
    }
  };
  xhr.onerror = function (e) {
    console.log(xhr.statusText);
  };
  xhr.send();
  return xhr;
}),

display : ( function display(key) {
  lib.dorequest('/display?key='+ key, false, (data) => {
    let d=JSON.parse(data)
    var info = document.getElementById("info");
    info.innerHTML = d.content;
    lib.currentDisplay = d.currentDisplay;
  } );
}),

next : ( function next() {
  lib.dorequest('/next?width=' + window.screen.width + '&height=' + window.screen.height, true);
}),

prev : ( function prev() {
  lib.dorequest('/prev?width=' + window.screen.width + '&height=' + window.screen.height, true);
}),

chooseView : ( function chooseView(c) {
  lib.dorequest('/sel?view=' + c + '&width=' + window.screen.width + '&height=' + window.screen.height, true);
}),

log : ( function log(text) {
  lib.dorequest('/log?text=' + text, false);
}),

keyup : ( function keyup(key) {
  switch ( key ) {
    case 'UpArrow':     // TV
    case 'DownArrow':   // TV
    case 'LeftArrow':   // TV
    case 'RightArrow':  // TV
    case 'ArrowUp':     // Browser
    case 'ArrowDown':   // Browser
    case 'ArrowLeft':   // Browser
    case 'ArrowRight':  // Browser
      lib.dorequest('/keyup?key=' + key, false);
      break;
  }
}),

keypress : ( function keypress(key) {
  lib.dorequest('/keypress?key=' + key, false);
}),

sel : ( function sel(c) {
  if ( lib.buttonTimer != '' ) window.clearTimeout( lib.buttonTimer );
  lib.buttonTimer = "";
  lib.queue.push(c.toString().toUpperCase());
  notice.innerHTML=lib.queue.join("")
  lib.buttonTimer = window.setTimeout(function () {
      var newch = lib.queue.join("");
      lib.queue = [];
      lib.chooseView(newch);
  }, 1000);
}),

fullScreen : ( function fullScreen() {
  fullScreenApi.requestFullScreen(document.documentElement);
} ),

handleSourceEstablished : ( function handleSourceEstablished() {
  if ( !lib.loadExpected ) {
      notice.innerHTML == "...";
      lib.loadExpected = true;
      location.reload();
  }
} ),

render : ( function render(resp) {
  const mode = resp.mode;
  let scalefactor = Math.ceil(Math.sqrt(mode));
  lib.initFullScreen();
  lib.loadExpected = true;

  currentView = resp.currentView;
  var notice = document.getElementById("notice");
  notice.innerHTML = resp.currentTitle;
  var lastFrames = -1;

  for (let i in lib.intervals) {
      clearInterval(lib.intervals[i]);
  }

  lib.intervals = [];
  let inv = setInterval(function() { if ( frames == lastFrames ) { notice.innerHTML = "Video Stalled"; frames = 0; lastFrames = -1 } else { lastFrames = frames } } , 10000);
  lib.intervals.push(inv);
  inv = setInterval(function() { lib.display('') } , 10000);
  lib.display();
  lib.intervals.push(inv);

  const table = document.getElementById("canvas");
  const trs = [];
  let tds = [];
  for (let i = 1; i < mode + 1; i++) {
      if (i !== 1 && ((i - 1) % (scalefactor) === 0)) {
          trs.push('<tr>' + tds.join('\n') + '</tr>');
          tds = [];
      }
      tds.push('<td> <canvas id="canvas' + i + '"/> </td>')
  }
  trs.push('<tr>' + tds.join('\n') + '</tr>');
  table.innerHTML = trs.join('\n')
  for (let i = 0; i < mode; i++) {
      const url = 'ws://' + serverInfo.ip + ':' + (9999 + i);
      players = [];
      let player = new JSMpeg.Player(url, {
          canvas: document.getElementById('canvas' + (i + 1)),
          onVideoDecode: function ondecode( ) { if ( frames == 60 ) { lib.loadExpected = false; frames = 61; notice.innerHTML = ""; } else if ( frames > 1000000 ) { frames = 10000 } else { frames = frames + 1 } },
          // onAudioDecode: function ondecode2( ) { if ( frames < 2000 ) notice.innerHTML = 'audio' },
      
          disableGl : true,
          onSourceEstablished: function sourceEstablished( ) { lib.handleSourceEstablished(); }
          //poster: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Sunflower_from_Silesia2.jpg/1600px-Sunflower_from_Silesia2.jpg?20091008132228',
          // onPlay: function a( ) { notice.innerHTML = "a" },
          // onPause: function b( ) { notice.innerHTML = "b" },
          // onEnded: function c( ) { notice.innerHTML = "c" },
          // onStalled: function d( ) { notice.innerHTML = "d" },
          // onSourceCompleted: function f( ) { notice.innerHTML = "f" },
      })
      players.push( player );
  }
} ),

initFullScreen : 
(function() {
	var
		fullScreenApi = {
			supportsFullScreen: false,
			isFullScreen: function() { return false; },
			requestFullScreen: function() {},
			cancelFullScreen: function() {},
			fullScreenEventName: '',
			prefix: ''
		},
		browserPrefixes = 'webkit moz o ms khtml'.split(' ');
	// check for native support
	if (typeof document.cancelFullScreen != 'undefined') {
		fullScreenApi.supportsFullScreen = true;
	} else {
		// check for fullscreen support by vendor prefix
		for (var i = 0, il = browserPrefixes.length; i < il; i++ ) {
			fullScreenApi.prefix = browserPrefixes[i];
			if (typeof document[fullScreenApi.prefix + 'CancelFullScreen' ] != 'undefined' ) {
				fullScreenApi.supportsFullScreen = true;
				break;
			}
		}
	}
	// update methods to do something useful
	if (fullScreenApi.supportsFullScreen) {
		fullScreenApi.fullScreenEventName = fullScreenApi.prefix + 'fullscreenchange';
		fullScreenApi.isFullScreen = function() {
			switch (this.prefix) {
				case '':
					return document.fullScreen;
				case 'webkit':
					return document.webkitIsFullScreen;
				default:
					return document[this.prefix + 'FullScreen'];
			}
		}
		fullScreenApi.requestFullScreen = function(el) {
			return (this.prefix === '') ? el.requestFullScreen() : el[this.prefix + 'RequestFullScreen']();
		}
		fullScreenApi.cancelFullScreen = function(el) {
			return (this.prefix === '') ? document.cancelFullScreen() : document[this.prefix + 'CancelFullScreen']();
		}
	}
	// jQuery plugin
	if (typeof jQuery != 'undefined') {
		jQuery.fn.requestFullScreen = function() {
			return this.each(function() {
				if (fullScreenApi.supportsFullScreen) {
					fullScreenApi.requestFullScreen(this);
				}
			});
		};
	}
	// export api
	window.fullScreenApi = fullScreenApi;
})
} ) }
