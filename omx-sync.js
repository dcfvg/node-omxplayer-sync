var fs = require('fs');
var server = require('http').createServer();
var socket = require('socket.io-client')('http://192.168.1.11:3000');
var io = require('socket.io')(server, {'pingInterval': 10000, 'pingTimeout': 15000});
var dbus = require('dbus-native');
var exec = require('child_process').exec;
var file = process.argv.slice(2)[0]; //get a path to the video argument
var options = '-o hdmi -b --loop --no-osd '
var currentPosition, totalDuration;
var bus; //main DBUS
var gate = true;
var omx;
var inReset = false;

server.listen(3000, function() { console.log( 'Listening on port 3000') });

// PARSE TERMINAL INPUT.
if(file == undefined){
  console.log('no video file specified');
  return
}
console.log('current video path: ' + file);

//kill previous player if the script needs to restart
var killall = exec('killall omxplayer.bin', (error, stdout, stderr) => {
  if (error) {
    console.error(`exec error: ${error}`);
    return;
  }
  console.log(`stdout: ${stdout}`);
  console.log(`stderr: ${stderr}`);
});

//start omx player
omx = exec('omxplayer '+options+file, (error, stdout, stderr) => {
  if (error) {
    console.error(`omxplayer exec error: ${error}`);
    return;
  }
  console.log(`exec omxplayer stdout: ${stdout}`);
  console.log(`exec omxplayer stderr: ${stderr}`);
});

omx.on('exit', function(code){
  console.log('EXIT CODE: '+ code +' @ ' + Date() );
  // relaunch omxplayer
  process.exit(0);
});

//SOCKET.IO HANDLING
io.on('connection', function(socket){

  var address = socket.handshake.address;
  var infos = address + '\t' + socket.id + ' \t  ' + Date();

  console.log('[!]\tconnected\t'+ infos);

  // fire loop flag on client connection
  console.log('R',inReset,'G',gate);
  if(!inReset){

    inReset = true;
    console.log('[R]\tReset in 5s\t (new connection from '+ address+')');

    resetOnNewClientTimeout = setTimeout(function(){
      io.emit('loopFlag', { loopFlag : 'loop' });
      inReset = false;
    }, 5000);
  }


  socket.on('disconnect', function(){
    console.log('[x]\tdisconnected\t'+ infos);
  });

});

socket.on('connect', function(){
  console.log('\nConnected to the broadcaster as: ' + socket.id + ' @ ' + Date()+' \n' );
});

socket.on('loopFlag', function(loopFlag){
  console.log('[>]\tloop flag recieved  \t\t ' + Date() + '\t' + inReset);

  seek( s2micro(1) );
  setTimeout(function(){ gate = true}, 1000)
})

//DBUS HANDLING
setTimeout(function(){ //wait for dbus to become available.

  bus = dbus.sessionBus({
    busAddress: fs.readFileSync('/tmp/omxplayerdbus.pi', 'ascii').trim()
  });

  setTimeout(function(){
    bus.invoke({
      path: '/org/mpris/MediaPlayer2',
      interface: 'org.freedesktop.DBus.Properties',
      member: 'Duration',
      destination: 'org.mpris.MediaPlayer2.omxplayer',
    }, function(err, duration) {
      totalDuration = duration; //set to a global
      console.log('Duration: ' + totalDuration);
    });

    //send out loop flag
    setInterval(function(){
      bus.invoke({
        path: '/org/mpris/MediaPlayer2',
        interface: 'org.freedesktop.DBus.Properties',
        member: 'Position',
        destination: 'org.mpris.MediaPlayer2.omxplayer',
      }, function(err, position) {
              currentPosition = position; //set to a global
              // console.log('CP: ' + currentPosition);
      });

      if(currentPosition >= totalDuration - s2micro(1) && gate == true){ //are we in the end range of the file?
        gate = false;
        console.log( '\tvideo Ended \t\t\t ' + Date() );
        io.emit('loopFlag', { loopFlag : 'loop' }); //add one of these above outside the interval loop to reset when the server boots?
      };

    },250);

  }, 1000);

}, 1000);

function seek(pos){
  bus.invoke({
          path: '/org/mpris/MediaPlayer2',
          interface: 'org.mpris.MediaPlayer2.Player',
          member: 'SetPosition',
          destination: 'org.mpris.MediaPlayer2.omxplayer',
          signature: 'ox',
          body: [ '/not/used', pos ]
  }, function(err) {
    if(err != null) console.log('ERROR: '+err);
  });
}

function s2micro(seconds){
  return seconds * 1000000;
}


