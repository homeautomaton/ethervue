'use strict';

/* eslint no-sequences: 0 */ // --> OFF
/* eslint no-unused-expressions: 0 */ // --> OFF
/* eslint no-restricted-globals: 0 */ // --> OFF
/* eslint no-unused-vars: 0 */ // --> OFF
/* eslint func-names: 0 */ // --> OFF
var serverInfo = {
  ip: localStorage.getItem('SERVER.IP') || '192.168.2.7', // <-- Server IP
  port: localStorage.getItem('SERVER.PORT') || '3004',
  inited: localStorage.getItem('SERVER.INITED') || false
};

var lib;
var frames = 0;
var players = [];
var stash_resp;

var req = function req( path ) {
  var xhr = new XMLHttpRequest();
  xhr.timeout = 2000; 
  var url = 'http://' + serverInfo.ip + ':' + serverInfo.port + path;
  xhr.withCredentials = false;
  xhr.open('GET', url, true);
  return xhr;
};

var getInfo = function getInfo(callback) {
  if (!serverInfo.inited) {
    window.location.href = '/server.html';
  } else {
    (function () {
      var xhr = req( '/info?width=' + window.screen.width + '&height=' + window.screen.height );
      xhr.onreadystatechange = function () {
        if (xhr.readyState === xhr.DONE) {
          if (xhr.status === 200) {
            callback(JSON.parse(xhr.responseText));
          } else {
            window.location.href = '/server.html';
          }
        }
      };
      xhr.onerror = function (e) {
        window.location.href = '/server.html';
        console.log(xhr.statusText);
      };
      xhr.send();
    })();
  }
};

var reload = function reload() {
  if (serverInfo.inited) {
    (function () {
      var xhr = req( '/reload?width=' + window.screen.width + '&height=' + window.screen.height );
      xhr.onreadystatechange = function () {
        if (xhr.readyState === xhr.DONE) {
          if (xhr.status === 200) {
            console.log(xhr.responseText);
            location.reload();
          } else {
            window.location.href = '/server.html';
          }
        }
      };
      xhr.onerror = function (e) {
        console.log(xhr.statusText);
      };
      xhr.send();
    })();
  } else {
    getInfo();
  }
};

var load_lib = function load_lib( callback ) {
    var xhr = req('/lib.js');
    xhr.responseType = 'text';
    xhr.onreadystatechange = function () {
      if (xhr.readyState === xhr.DONE) {
        if (xhr.status === 200) {
          var moduleCode = xhr.responseText;
          lib = eval(moduleCode);
          tizen.systeminfo.getPropertyValue("BUILD", function(result) {
             if (result.model === "Emulator") {
                 // emulator needs some time before trying to load jsmpeg, apparently
                 let timeoutID = setTimeout(callback, 1500);
             } else {
                 callback();
             }
          });
        } else {
          window.location.href = '/server.html';
        }
      }
    };
    xhr.send();
};


// Initialize function
var main = function main() {
  let remotekeys = ['0','1','2','3','4','5','6','7','8','9',
       'ChannelUp',
       'ChannelDown',
       'Minus',                 //198
       'ColorF0Red',            //403
       'ColorF1Green',          //404
       'ColorF2Yellow',         //405
       'ColorF3Blue',           //406
       'PreviousChannel',       //10190
       'MediaPlayPause',        //10252
       'MediaFastForward',      //417
       'MediaRewind',           //412
       'MediaPlay',             //415
       'MediaStop',             //413
       'MediaTrackPrevious',    //10232
       'MediaTrackNext',        //10233
       'MediaPause',            //19
       'VolumeMute',            //449
       'Menu',                  //18
       'Tools',                 //10135
       'Info',                  //457
       'Source',                //10072
       'Exit',                  //10182
       'PictureSize',           //10140
       'ChannelList',           //10073
     ];
  for ( let k in remotekeys ) {
    try {
       tizen.tvinputdevice.registerKey(remotekeys[k]);
    }
    catch(err) { }         //okay if not all keys are defined
  }

  document.addEventListener('visibilitychange', function () {
    reload();
  });

  // add eventListener for keydown
  document.addEventListener('keydown', function (e) {
    console.log('Key code : ' + e.keyCode);
    var notice = document.getElementById("notice");
    switch (e.keyCode) {
      case 48:
      case 49:
      case 50:
      case 51:
      case 52:
      case 53:
      case 54:
      case 55:
      case 56:
      case 57:
        lib.key(e.keyCode - 48);
        break;
      case 403:
        lib.key('A');
        break;
      case 404:
        lib.key('B');
        break;
      case 405:
        lib.key('C');
        break;
      case 406:
        lib.key('D');
        break;
      case 427:
        lib.key('Channel+');
        break;
      case 428:
        lib.key('Channel-');
        break;
      case 415:  // MediaPlay
        lib.key('MediaPlay');
        break;
      case 10009: // RETURN button
        lib.key('TVReturn');
        break;
      case 10182: // EXIT button
        notice.innerHTML='EXIT';
        tizen.application.getCurrentApplication().exit();
        break;
      case 13: // OK button
        lib.key('Ok');
        break;
      case 38: // UP arrow
        lib.key('UpArrow');
        break;
      case 39: // RIGHT arrow
        lib.key('RightArrow');
        break;
      case 37: // LEFT arrow
        lib.key('LeftArrow');
        break;
      case 40: // DOWN arrow
        lib.key('DownArrow');
        break;
      case 10190:
        lib.key('PreviousChannel');
        break;
      case 198:
        lib.key('Minus');
        break;
      case 10252:
        lib.key('MediaPlayPause');
        break;
      case 417:
        lib.key('MediaFastForward');
        break;
      case 412:
        lib.key('MediaRewind');
        break;
      case 413:
        lib.key('MediaStop');
        break;
      case 10232:
        lib.key('MediaTrackPrevious');
        break;
      case 10233:
        lib.key('MediaTrackNext');
        break;
      case 19:
        lib.key('MediaPause');
        break;
      case 449:
        lib.key('VolumeMute');
        break;
      case 18:
        lib.key('Menu');
        break;
      case 10135:
        lib.key('Tools');
        break;
      case 457:
        lib.key('Info');
        break;
      case 10072:
        lib.key('Source');
        break;
      case 10140:
        lib.key('PictureSize');
        break;
      case 10073:
        lib.key('ChannelList');
        break;

      default:
        //console.log('Key code : ' + e.keyCode);
        //alert('Key code : ' + e.keyCode);
        break;
    }
  }, true);

  var voicecontrol = tizen.voicecontrol;
  if (voicecontrol) {
    var client 
    try { 
      client = voicecontrol.getVoiceControlClient();
    } catch(e) {
      console.log('Voice Client Error', e);
    }
    if (client) {
      var commands = [new tizen.VoiceControlCommand('ChannelUp'), new tizen.VoiceControlCommand('ChannelDown'), new tizen.VoiceControlCommand('Refresh'), new tizen.VoiceControlCommand('Select'), new tizen.VoiceControlCommand('OK')];
      for (var i = 0; i < 1000; i++) {
        // eslint-disable-line no-plusplus
        commands.push(new tizen.VoiceControlCommand('' + i));
      }
      try {
        client.setCommandList(commands, 'FOREGROUND');

        var resultListenerCallback = function resultListenerCallback(event, list, result) {
          if (event === 'SUCCESS') {
            if (!isNaN(result)) {
              lib.sel(result);
            }
            if (result === 'OK' || result === 'Refresh' || result === 'Select') {
              reload();
            }
          }
          console.log('Result callback - event: ' + event + ', result: ' + result);
        };

        client.addResultListener(resultListenerCallback);
      } catch (e) {
        console.log('Voice Control Error', e);
      }
    }
  }
};

var init = function init() {
  load_lib(main);
};

// window.onload can work without <body onload="">
window.onload = init;
