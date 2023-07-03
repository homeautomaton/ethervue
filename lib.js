{ http: ( { 
queue : [],
changeView : false,
loadExpected : false,
showKeys : true,

key : ( function key( k ) {
    k = k.toString();
    if ( lib.showKeys ) notice.innerHTML = k;
    if ( k.length == 1 && ( k >= '0' && k <= '9' || k >= 'A' && k <= 'D' ) ) {
      lib.sel( k );

    // TV
    } else if ( k == 'Channel+' ) {
      lib.next();
    } else if ( k == 'Channel-' ) {
      lib.prev();
    } else if ( k == 'MediaPlay' ) {
      notice.innerHTML='Reload';
      reload();
    } else if ( k == 'PreviousChannel' ) {
      notice.innerHTML='Refresh';
      location.reload();

    // Browser
    } else if ( k == 'Escape' ) {
      notice.innerHTML = 'Reload';
      reload();
    } else if ( k == 'r' ) {
      notice.innerHTML = 'Refresh';
      location.reload();
    } else if ( k == 'f' ) {
      notice.innerHTML = 'Fullscreen';
      lib.fullScreen();
    } else if ( k == '|' ) {
      lib.showKeys = ! lib.showKeys;
    }
} ),

keyup : ( function keyup( k ) {
} ),

req : ( function req( path ) {
  var xhr = new XMLHttpRequest();
  var url = 'http://' + serverInfo.ip + ':' + serverInfo.port + path;
  xhr.withCredentials = true;
  xhr.open('GET', url, true);
  return xhr;
} ),

dorequest : ( function dorequest( path ) {
  var xhr = lib.req( path );
  xhr.onreadystatechange = function () {
    if (xhr.readyState === xhr.DONE) {
      if (xhr.status === 200) {
        console.log(xhr.responseText);
        location.reload();
      } else {
        console.log('There was a problem with the request.');
      }
    }
  };
  xhr.onerror = function (e) {
    console.log(xhr.statusText);
  };
  xhr.send();
}),

next : ( function next() {
  lib.dorequest('/next?width=' + window.screen.width + '&height=' + window.screen.height);
}),

prev : ( function prev() {
  lib.dorequest('/prev?width=' + window.screen.width + '&height=' + window.screen.height);
}),

sel0 : ( function sel0(c) {
  lib.dorequest('/sel?view=' + c + '&width=' + window.screen.width + '&height=' + window.screen.height);
}),

log : ( function log(text) {
  lib.dorequest('/log?text=' + text);
}),

sel : ( function sel(c) {
  lib.queue.push(c.toString().toUpperCase());
  notice.innerHTML=lib.queue.join("")
  if (!lib.changeView) {
    lib.changeView = true;
    window.setTimeout(function () {
      var ch = { value: '' };
      var newch = lib.queue.join("");
      lib.changeView = false;
      lib.queue = [];
      lib.sel0(newch);
    }, 1000);
  }
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

  setInterval(function() { if ( frames == lastFrames ) { notice.innerHTML = "Video Stalled"; frames = 0; lastFrames = -1 } else { lastFrames = frames } } , 10000);

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
