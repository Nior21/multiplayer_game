const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: { origin: "*" }
});

const FIELD_SIZE = 15;
const TILE_SIZE = 40;
const WALLS_COUNT = 50;


const BRIGHT_COLORS = [
  '#FF5252', '#FF4081', '#E040FB', '#7C4DFF', '#536DFE',
  '#448AFF', '#40C4FF', '#18FFFF', '#64FFDA', '#69F0AE'
];

function generateField() {
  const field = Array(FIELD_SIZE).fill().map(() => Array(FIELD_SIZE).fill(0));

  for (let i = 0; i < FIELD_SIZE; i++) {
    for (let j = 0; j < FIELD_SIZE; j++) {
      if (i === 0 || j === 0 || i === FIELD_SIZE - 1 || j === FIELD_SIZE - 1) {
        field[i][j] = 1;
      } else if (i % 2 === 0 && j % 2 === 0) {
        field[i][j] = 1;
      }
    }
  }

  let placed = 0;
  while (placed < WALLS_COUNT) {
    const x = Math.floor(Math.random() * FIELD_SIZE);
    const y = Math.floor(Math.random() * FIELD_SIZE);

    if (field[x][y] === 0 && !(x <= 1 && y <= 1) && !(x >= FIELD_SIZE - 2 && y >= FIELD_SIZE - 2)) {
      field[x][y] = 2;
      placed++;
    }
  }

  return field;
}

function findEmptySpot(field) {
  while (true) {
    const x = Math.floor(Math.random() * (FIELD_SIZE - 2)) + 1;
    const y = Math.floor(Math.random() * (FIELD_SIZE - 2)) + 1;

    if (field[x][y] === 0) {
      return { x, y };
    }
  }
}

const players = {};
const spells = [];
const field = generateField();

function getRandomColor() {
  return BRIGHT_COLORS[Math.floor(Math.random() * BRIGHT_COLORS.length)];
}

function generateNickname() {
  const adjectives = ['Swift', 'Mighty', 'Silent', 'Brave', 'Clever'];
  const animals = ['Fox', 'Wolf', 'Eagle', 'Bear', 'Tiger'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  return `${adj}${animal}`;
}

app.use(express.static('public'));

io.on('connection', (socket) => {
  const color = getRandomColor();
  const nickname = generateNickname();
  const spawn = findEmptySpot(field);

  players[socket.id] = {
    id: socket.id,
    nickname,
    color,
    x: spawn.x,
    y: spawn.y,
    direction: 'down',
    score: 0,
    hp: 100,
    spells: [
      { type: 'water', speed: 5, power: 5, selected: true },
      { type: 'shield', speed: 5, power: 5, selected: false },
      null, null, null, null, null, null
    ]
  };

  socket.emit('init', {
    id: socket.id,
    nickname,
    color,
    field,
    fieldSize: FIELD_SIZE,
    tileSize: TILE_SIZE,
    allPlayers: players,
    allSpells: spells
  });

  io.emit('playerJoined', players[socket.id]);

  socket.on('move', (direction) => {
    const player = players[socket.id];
    if (!player) return;

    player.direction = direction;

    let newX = player.x;
    let newY = player.y;

    if (direction === 'up') newY--;
    if (direction === 'down') newY++;
    if (direction === 'left') newX--;
    if (direction === 'right') newX++;

    if (newX >= 0 && newX < FIELD_SIZE && newY >= 0 && newY < FIELD_SIZE) {
      if (field[newX][newY] === 0) {
        player.x = newX;
        player.y = newY;
        io.emit('playerMoved', {
          id: socket.id,
          x: newX,
          y: newY,
          direction
        });
      }
    }
  });

  socket.on('updateSpell', (data) => {
    const player = players[socket.id];
    if (!player || data.index < 0 || data.index >= 8) return;

    player.spells[data.index] = {
      type: data.type,
      speed: data.speed,
      power: data.power,
      selected: data.selected || false
    };

    io.emit('playerUpdated', players[socket.id]);
  });

  socket.on('selectSpell', (index) => {
    const player = players[socket.id];
    if (!player || index < 0 || index >= 8) return;

    player.spells.forEach((spell, i) => {
      if (spell) spell.selected = (i === index);
    });

    io.emit('playerUpdated', players[socket.id]);
  });

  socket.on('castSpell', () => {
    const player = players[socket.id];
    if (!player) return;

    const selectedSpell = player.spells.find(s => s && s.selected);
    if (!selectedSpell) return;

    let targetX = player.x;
    let targetY = player.y;

    const maxDistance = 10;
    let distance = 0;

    while (distance < maxDistance) {
      if (player.direction === 'up') targetY--;
      if (player.direction === 'down') targetY++;
      if (player.direction === 'left') targetX--;
      if (player.direction === 'right') targetX++;

      if (targetX < 0 || targetX >= FIELD_SIZE || targetY < 0 || targetY >= FIELD_SIZE) {
        break;
      }

      if (field[targetX][targetY] !== 0) {
        break;
      }

      distance++;
    }

    if (selectedSpell.type === 'shield') {
      player.hp += selectedSpell.power * 2;
      if (player.hp > 100) player.hp = 100;
      io.emit('playerUpdated', player);
      return;
    }

    const spell = {
      id: Date.now() + '_' + socket.id,
      playerId: socket.id,
      type: selectedSpell.type,
      power: selectedSpell.power,
      speed: selectedSpell.speed,
      x: player.x,
      y: player.y,
      targetX: targetX,
      targetY: targetY,
      direction: player.direction,
      progress: 0
    };

    spells.push(spell);
    io.emit('spellCast', spell);
  });

  socket.on('rename', (newNickname) => {
    if (players[socket.id] && newNickname && newNickname.trim().length > 0) {
      players[socket.id].nickname = newNickname.trim().substring(0, 12);
      io.emit('playerUpdated', players[socket.id]);
    }
  });

  socket.on('disconnect', () => {
    const disconnectedPlayer = players[socket.id];
    delete players[socket.id];
    if (disconnectedPlayer) {
      io.emit('playerLeft', disconnectedPlayer.id);
    }
  });
});

function gameLoop() {
  for (let i = spells.length - 1; i >= 0; i--) {
    const spell = spells[i];
    spell.progress += 0.05 * spell.speed;

    if (spell.progress >= 1) {
      const tx = Math.round(spell.targetX);
      const ty = Math.round(spell.targetY);

      if (tx >= 0 && tx < FIELD_SIZE && ty >= 0 && ty < FIELD_SIZE) {
        if (field[tx][ty] === 2) {
          field[tx][ty] = 0;

          const player = players[spell.playerId];
          if (player) {
            player.score += 10;
            io.emit('playerUpdated', player);
          }

          io.emit('blockDestroyed', { x: tx, y: ty });
        }
      }

      spells.splice(i, 1);
      io.emit('spellHit', { spellId: spell.id, x: tx, y: ty });
    }
  }

  io.emit('spellsUpdate', spells);
}

setInterval(gameLoop, 1000 / 30);

http.listen(3000, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:3000`);
});