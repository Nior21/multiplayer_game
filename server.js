const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: "*"
  }
});

const FIELD_SIZE = 21;
const TILE_SIZE = 40;
const WALLS_COUNT = 80;
const BLOCK_RESPAWN_RATE = 10000; // 10 секунд
const INITIAL_BLOCKS = 40;

const BRIGHT_COLORS = [
  '#FF5252', '#FF4081', '#E040FB', '#7C4DFF', '#536DFE',
  '#448AFF', '#40C4FF', '#18FFFF', '#64FFDA', '#69F0AE'
];

// Хранение данных игроков
const players = new Map(); // id -> player
const spells = [];
let field = generateField();

function generateField() {
  const field = Array(FIELD_SIZE).fill().map(() => Array(FIELD_SIZE).fill(0));

  // Границы и несокрушимые стены
  for (let i = 0; i < FIELD_SIZE; i++) {
    for (let j = 0; j < FIELD_SIZE; j++) {
      if (i === 0 || j === 0 || i === FIELD_SIZE - 1 || j === FIELD_SIZE - 1) {
        field[i][j] = 1;
      } else if (i % 2 === 0 && j % 2 === 0) {
        field[i][j] = 1;
      }
    }
  }

  // Разрушаемые блоки
  let placed = 0;
  while (placed < INITIAL_BLOCKS) {
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
  const emptySpots = [];
  for (let x = 1; x < FIELD_SIZE - 1; x++) {
    for (let y = 1; y < FIELD_SIZE - 1; y++) {
      if (field[x][y] === 0) {
        emptySpots.push({
          x,
          y
        });
      }
    }
  }
  return emptySpots[Math.floor(Math.random() * emptySpots.length)] || {
    x: 1,
    y: 1
  };
}

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

function respawnBlocks() {
  const emptySpots = [];
  for (let x = 1; x < FIELD_SIZE - 1; x++) {
    for (let y = 1; y < FIELD_SIZE - 1; y++) {
      if (field[x][y] === 0) {
        emptySpots.push({
          x,
          y
        });
      }
    }
  }

  if (emptySpots.length > 0) {
    const spot = emptySpots[Math.floor(Math.random() * emptySpots.length)];
    field[spot.x][spot.y] = 2;
    io.emit('blockRespawned', {
      x: spot.x,
      y: spot.y
    });
  }
}

app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // Восстановление данных игрока или создание нового
  let playerData = players.get(socket.id);
  if (!playerData) {
    const spawn = findEmptySpot(field);
    playerData = {
      id: socket.id,
      nickname: generateNickname(),
      color: getRandomColor(),
      x: spawn.x,
      y: spawn.y,
      direction: 'down',
      score: 0,
      hp: 100,
      shield: 0,
      spells: [{
          type: 'water',
          speed: 5,
          power: 5,
          selected: true
        },
        {
          type: 'shield',
          speed: 5,
          power: 5,
          selected: false
        },
        null, null, null, null, null, null
      ]
    };
    players.set(socket.id, playerData);
  }

  socket.emit('init', {
    id: socket.id,
    nickname: playerData.nickname,
    color: playerData.color,
    field,
    fieldSize: FIELD_SIZE,
    tileSize: TILE_SIZE,
    allPlayers: Object.fromEntries(players),
    allSpells: spells
  });

  io.emit('playerJoined', playerData);

  socket.on('move', (direction) => {
    const player = players.get(socket.id);
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
    const player = players.get(socket.id);
    if (!player || data.index < 0 || data.index >= 8) return;

    player.spells[data.index] = data.type ? {
      type: data.type,
      speed: data.speed,
      power: data.power,
      selected: data.selected || false
    } : null;

    // Если слот удален, выбрать первый доступный
    if (player.spells[data.index] && data.selected) {
      player.spells.forEach((spell, i) => {
        if (spell && i !== data.index) spell.selected = false;
      });
    }

    io.emit('playerUpdated', player);
  });

  socket.on('selectSpell', (index) => {
    const player = players.get(socket.id);
    if (!player || index < 0 || index >= 8 || !player.spells[index]) return;

    player.spells.forEach((spell, i) => {
      if (spell) spell.selected = (i === index);
    });

    io.emit('playerUpdated', player);
  });

  socket.on('castSpell', () => {
    const player = players.get(socket.id);
    if (!player) return;

    const selectedSpell = player.spells.find(s => s && s.selected);
    if (!selectedSpell) return;

    if (selectedSpell.type === 'shield') {
      player.shield = selectedSpell.power * 2;
      if (player.shield > 50) player.shield = 50;
      io.emit('playerUpdated', player);
      return;
    }

    let targetX = player.x;
    let targetY = player.y;
    const maxDistance = 10;

    for (let distance = 0; distance < maxDistance; distance++) {
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
    }

    const spell = {
      id: Date.now() + '_' + socket.id,
      playerId: socket.id,
      type: selectedSpell.type,
      power: selectedSpell.power,
      speed: selectedSpell.speed,
      x: player.x,
      y: player.y,
      targetX,
      targetY,
      direction: player.direction,
      progress: 0
    };

    spells.push(spell);
    io.emit('spellCast', spell);
  });

  socket.on('rename', (newNickname) => {
    const player = players.get(socket.id);
    if (player && newNickname && newNickname.trim().length > 0) {
      player.nickname = newNickname.trim().substring(0, 12);
      io.emit('playerUpdated', player);
    }
  });

  socket.on('resetField', () => {
    field = generateField();
    io.emit('fieldReset', field);

    // Перемещаем всех игроков в безопасные места
    players.forEach((player, id) => {
      const spawn = findEmptySpot(field);
      player.x = spawn.x;
      player.y = spawn.y;
      io.emit('playerMoved', {
        id,
        x: spawn.x,
        y: spawn.y,
        direction: player.direction
      });
    });
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    // Не удаляем игрока, сохраняем для возможного возврата
    io.emit('playerLeft', socket.id);
  });
});

function gameLoop() {
  // Обновление заклинаний
  for (let i = spells.length - 1; i >= 0; i--) {
    const spell = spells[i];
    spell.progress += 0.05 * spell.speed;

    if (spell.progress >= 1) {
      const tx = Math.round(spell.targetX);
      const ty = Math.round(spell.targetY);

      if (tx >= 0 && tx < FIELD_SIZE && ty >= 0 && ty < FIELD_SIZE) {
        if (field[tx][ty] === 2) {
          field[tx][ty] = 0;

          const player = players.get(spell.playerId);
          if (player) {
            player.score += 10;
            io.emit('playerUpdated', player);
          }

          io.emit('blockDestroyed', {
            x: tx,
            y: ty
          });
        }
      }

      spells.splice(i, 1);
      io.emit('spellHit', {
        spellId: spell.id,
        x: tx,
        y: ty
      });
    }
  }

  io.emit('spellsUpdate', spells);
}

// Респавн блоков каждые 10 секунд
setInterval(respawnBlocks, BLOCK_RESPAWN_RATE);

// Игровой цикл
setInterval(gameLoop, 1000 / 30);

http.listen(3000, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:3000`);
  console.log(`Field size: ${FIELD_SIZE}x${FIELD_SIZE}`);
  console.log(`Initial blocks: ${INITIAL_BLOCKS}`);
  console.log(`Block respawn: ${BLOCK_RESPAWN_RATE/1000} seconds`);
});