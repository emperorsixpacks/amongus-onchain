
import WebSocket from 'ws';

const API_URL = "https://among.outray.dev.outray.app";
const WS_URL = "wss://among.outray.dev.outray.app";

const MY_ADDRESS = "0x4842e8d45c5dbe578170f887a5c2532d718d08d4";
const MY_NAME = "Imposter";

let ws;

function connect() {
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log('Connected! Authenticating...');
    ws.send(
      JSON.stringify({
        type: 'agent:authenticate',
        address: MY_ADDRESS,
        name: MY_NAME,
      }),
    );
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    console.log('Received:', msg);
    handleMessage(msg);
  });

  ws.on('close', () => {
    console.log('Disconnected. Reconnecting in 5s...');
    setTimeout(connect, 5000);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'server:authenticated':
      console.log('Authenticated! Finding game...');
      findAndJoinGame();
      break;
    case 'server:room_update':
      console.log(`In room: ${msg.room.roomId}, Phase: ${msg.room.phase}`);
      break;
    case 'server:error':
      console.error(`Error [${msg.code}]: ${msg.message}`);
      break;
  }
}

async function findAndJoinGame() {
  try {
    const res = await fetch(`${API_URL}/api/rooms`);
    const { rooms } = await res.json();
    const lobby = rooms.find((r) => r.phase === 'lobby');

    if (lobby) {
      console.log(`Found lobby: ${lobby.roomId}. Joining...`);
      ws.send(
        JSON.stringify({
          type: 'agent:join_game',
          gameId: lobby.roomId,
          colorId: Math.floor(Math.random() * 12),
        }),
      );
    } else {
      console.log('No lobby available. Retrying in 10s...');
      setTimeout(findAndJoinGame, 10000);
    }
  } catch (error) {
    console.error('Error finding game:', error);
    setTimeout(findAndJoinGame, 10000);
  }
}

connect();
