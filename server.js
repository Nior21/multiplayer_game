const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Конфигурация игры
const GRID_SIZE = 21;
const CELL_SIZE = 40;
const INITIAL_PLAYER_HP = 10;
const BLOCK_HP = 5;
const RESPAWN_TIME = 3000;
const BLOCK_GENERATION_INTERVAL = 3500;

// Случайные имена для игроков
const ADJECTIVES = ['Swift', 'Mighty', 'Silent', 'Brave', 'Clever', 'Fierce', 'Noble', 'Wild', 'Epic', 'Rapid'];
const ANIMALS = ['Fox', 'Wolf', 'Eagle', 'Bear', 'Tiger', 'Lion', 'Hawk', 'Owl', 'Shark', 'Dragon'];

function generateNickname() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${adj}${animal}`;
}

// Яркие цвета для игроков
const BRIGHT_COLORS = [
  '#FF5252', '#FF4081', '#E040FB', '#7C4DFF', '#536DFE',
  '#448AFF', '#40C4FF', '#18FFFF', '#64FFDA', '#69F0AE'
];

function getRandomColor() {
  return BRIGHT_COLORS[Math.floor(Math.random() * BRIGHT_COLORS.length)];
}

// Игровое состояние
let gameState = {
  players: {},
  spells: [],
  blocks: [],
  lastBlockGeneration: Date.now()
};

// Генерация карты
function generateMap() {
  const blocks = [];

  // Несокрушимые стены по периметру
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let y = 0; y < GRID_SIZE; y++) {
      // Стены по краям
      if (x === 0 || y === 0 || x === GRID_SIZE - 1 || y === GRID_SIZE - 1) {
        blocks.push({
          x,
          y,
          hp: -1,
          indestructible: true
        });
      }
      // Шахматный порядок внутренних стен (каждая 2я клетка)
      else if (x % 2 === 0 && y % 2 === 0) {
        blocks.push({
          x,
          y,
          hp: -1,
          indestructible: true
        });
      }
      // Разрушаемые блоки (30% свободных клеток)
      else if (Math.random() < 0.3 && x > 1 && x < GRID_SIZE - 2 && y > 1 && y < GRID_SIZE - 2) {
        blocks.push({
          x,
          y,
          hp: BLOCK_HP,
          indestructible: false
        });
      }
    }
  }

  console.log(`Generated ${blocks.length} blocks on map`);
  return blocks;
}

// Получить случайную свободную позицию
function getRandomSpawnPosition() {
  let attempts = 0;
  while (attempts < 100) {
    const x = Math.floor(Math.random() * (GRID_SIZE - 4)) + 2;
    const y = Math.floor(Math.random() * (GRID_SIZE - 4)) + 2;

    const isBlocked = gameState.blocks.some(block =>
      block.x === x && block.y === y && !block.indestructible
    );

    const hasPlayer = Object.values(gameState.players).some(player =>
      Math.floor(player.x) === x && Math.floor(player.y) === y
    );

    if (!isBlocked && !hasPlayer) {
      return {
        x: x + 0.5,
        y: y + 0.5
      };
    }

    attempts++;
  }

  return {
    x: Math.floor(GRID_SIZE / 2) + 0.5,
    y: Math.floor(GRID_SIZE / 2) + 0.5
  };
}

// Проверить коллизии
function checkCollision(x, y, ignorePlayerId = null) {
  if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) {
    return true;
  }

  const block = gameState.blocks.find(b =>
    Math.floor(b.x) === Math.floor(x) && Math.floor(b.y) === Math.floor(y)
  );

  if (block && block.hp !== 0) {
    return true;
  }

  for (const [id, player] of Object.entries(gameState.players)) {
    if (id !== ignorePlayerId &&
      Math.floor(player.x) === Math.floor(x) &&
      Math.floor(player.y) === Math.floor(y) &&
      player.hp > 0) {
      return true;
    }
  }

  return false;
}

// Обновить блоки
function updateBlocks() {
  const now = Date.now();
  if (now - gameState.lastBlockGeneration >= BLOCK_GENERATION_INTERVAL) {
    const emptyCells = [];
    for (let x = 2; x < GRID_SIZE - 2; x++) {
      for (let y = 2; y < GRID_SIZE - 2; y++) {
        if (x % 2 !== 0 || y % 2 !== 0) {
          const hasBlock = gameState.blocks.some(b => b.x === x && b.y === y && b.hp > 0);
          const hasPlayer = Object.values(gameState.players).some(p =>
            Math.floor(p.x) === x && Math.floor(p.y) === y
          );

          if (!hasBlock && !hasPlayer) {
            emptyCells.push({
              x,
              y
            });
          }
        }
      }
    }

    if (emptyCells.length > 0) {
      const cell = emptyCells[Math.floor(Math.random() * emptyCells.length)];
      gameState.blocks.push({
        x: cell.x,
        y: cell.y,
        hp: BLOCK_HP,
        indestructible: false
      });
    }

    gameState.lastBlockGeneration = now;
  }
}

// Инициализировать карту
gameState.blocks = generateMap();

// Интервал обновления игры
setInterval(() => {
  updateBlocks();

  // Обновить заклинания
  gameState.spells = gameState.spells.filter(spell => {
    spell.x += Math.cos(spell.direction) * 0.1;
    spell.y += Math.sin(spell.direction) * 0.1;
    spell.distance += 0.1;

    spell.currentDamage = Math.max(0, spell.power - Math.floor(spell.distance));

    if (spell.currentDamage <= 0) {
      return false;
    }

    if (spell.x < 0 || spell.x >= GRID_SIZE || spell.y < 0 || spell.y >= GRID_SIZE) {
      return false;
    }

    const block = gameState.blocks.find(b =>
      Math.floor(b.x) === Math.floor(spell.x) &&
      Math.floor(b.y) === Math.floor(spell.y)
    );

    if (block) {
      if (block.indestructible) {
        return false;
      } else if (block.hp > 0) {
        block.hp -= spell.currentDamage;
        if (block.hp <= 0) {
          block.hp = 0;
          if (gameState.players[spell.casterId]) {
            gameState.players[spell.casterId].score += 10;
          }
        }
        return false;
      }
    }

    for (const [id, player] of Object.entries(gameState.players)) {
      if (id !== spell.casterId &&
        player.hp > 0 &&
        Math.floor(player.x) === Math.floor(spell.x) &&
        Math.floor(player.y) === Math.floor(spell.y)) {

        const damage = spell.currentDamage;

        if (player.shield > 0) {
          const shieldDamage = Math.min(player.shield, damage);
          player.shield -= shieldDamage;
          const remainingDamage = damage - shieldDamage;

          if (remainingDamage > 0) {
            player.hp = Math.max(0, player.hp - remainingDamage);
          }
        } else {
          player.hp = Math.max(0, player.hp - damage);
        }

        if (gameState.players[spell.casterId]) {
          gameState.players[spell.casterId].score += damage * 5;
        }

        if (player.hp <= 0) {
          player.respawnTime = Date.now() + RESPAWN_TIME;

          if (gameState.players[spell.casterId]) {
            gameState.players[spell.casterId].score += player.score;
            player.score = 0;
          }
        }

        return false;
      }
    }

    return spell.distance < spell.power * 2;
  });

  const now = Date.now();
  for (const player of Object.values(gameState.players)) {
    if (player.hp <= 0 && player.respawnTime && now >= player.respawnTime) {
      const spawnPos = getRandomSpawnPosition();
      player.x = spawnPos.x;
      player.y = spawnPos.y;
      player.hp = INITIAL_PLAYER_HP;
      player.shield = 0;
      player.respawnTime = null;
    }
  }

  io.emit('gameState', gameState);
}, 50);

// Обработка подключений Socket.IO
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  const spawnPos = getRandomSpawnPosition();
  const nickname = generateNickname();
  const color = getRandomColor();

  // ИСПРАВЛЕНО: правильный начальный порядок заклинаний
  gameState.players[socket.id] = {
    id: socket.id,
    x: spawnPos.x,
    y: spawnPos.y,
    direction: 0,
    hp: INITIAL_PLAYER_HP,
    shield: 0,
    score: 0,
    nickname: nickname,
    color: color,
    spells: [{
        type: 'water',
        speed: 5,
        power: 6
      },
      {
        type: 'shield',
        speed: 5,
        power: 6
      },
      null // Пустой слот в конце
    ],
    casting: null,
    lastCastTime: 0
  };

  console.log(`Player ${nickname} spawned at (${spawnPos.x}, ${spawnPos.y})`);

  socket.emit('init', {
    playerId: socket.id,
    gridSize: GRID_SIZE,
    cellSize: CELL_SIZE,
    nickname: nickname,
    color: color
  });

  socket.emit('gameState', gameState);

  socket.on('move', (direction) => {
    const player = gameState.players[socket.id];
    if (!player || player.hp <= 0) return;

    switch (direction) {
      case 'up':
        player.direction = -Math.PI / 2;
        break;
      case 'down':
        player.direction = Math.PI / 2;
        break;
      case 'left':
        player.direction = Math.PI;
        break;
      case 'right':
        player.direction = 0;
        break;
    }

    let newX = player.x;
    let newY = player.y;

    switch (direction) {
      case 'up':
        newY -= 1;
        break;
      case 'down':
        newY += 1;
        break;
      case 'left':
        newX -= 1;
        break;
      case 'right':
        newX += 1;
        break;
    }

    if (!checkCollision(newX, newY, socket.id)) {
      player.x = newX;
      player.y = newY;
    }
  });

  socket.on('castSpell', ({
    spellIndex
  }) => {
    const player = gameState.players[socket.id];
    // ВАЖНО: проверяем, что индекс корректный и заклинание существует
    if (!player || player.hp <= 0 || player.spells[spellIndex] === undefined || !player.spells[spellIndex]) {
      console.log(`Invalid cast: player=${!!player}, hp=${player?.hp}, spellIndex=${spellIndex}, spell=${player?.spells?.[spellIndex]}`);
      return;
    }

    const spell = player.spells[spellIndex];
    const now = Date.now();

    // ВАЖНО: минимальный кулдаун 100мс для предотвращения спама
    if (now - player.lastCastTime < 100) {
      return;
    }

    // ВАЖНО: проверяем, что не кастуем другое заклинание
    if (player.casting) {
      return;
    }

    player.casting = {
      index: spellIndex,
      startTime: now,
      duration: spell.speed * 250
    };
    player.lastCastTime = now;

    console.log(`Player ${player.nickname} casting ${spell.type} (speed: ${spell.speed}, power: ${spell.power})`);

    if (spell.type === 'shield') {
      setTimeout(() => {
        // ВАЖНО: проверяем, что игрок все еще жив и кастит то же заклинание
        if (gameState.players[socket.id] &&
          gameState.players[socket.id].casting &&
          gameState.players[socket.id].casting.index === spellIndex) {
          gameState.players[socket.id].shield = spell.power * 2;
          gameState.players[socket.id].casting = null;
          console.log(`Shield applied to ${gameState.players[socket.id].nickname}: ${spell.power * 2} HP`);
        }
      }, spell.speed * 250);
    }
  });

  socket.on('castComplete', () => {
    const player = gameState.players[socket.id];
    if (!player || !player.casting || player.hp <= 0) return;

    const spell = player.spells[player.casting.index];
    if (!spell || spell.type !== 'water') return;

    // Создаем водяной выстрел
    gameState.spells.push({
      id: `${socket.id}-${Date.now()}`,
      casterId: socket.id,
      type: 'water',
      x: player.x,
      y: player.y,
      direction: player.direction,
      power: spell.power,
      currentDamage: spell.power,
      distance: 0
    });

    console.log(`Player ${player.nickname} cast water spell (power: ${spell.power})`);
    player.casting = null;
  });

  socket.on('updateNickname', (nickname) => {
    if (gameState.players[socket.id]) {
      gameState.players[socket.id].nickname = nickname.substring(0, 20);
    }
  });

  socket.on('updateSpell', ({
    index,
    spell
  }) => {
    const player = gameState.players[socket.id];
    if (player && index >= 0 && index < 8) {
      player.spells[index] = spell;

      if (player.spells.length < 8 && !player.spells.includes(null)) {
        player.spells.push(null);
      }
    }
  });

  socket.on('removeSpell', (index) => {
    const player = gameState.players[socket.id];
    if (player && player.spells[index]) {
      player.spells[index] = null;

      while (player.spells.length > 0 && player.spells[player.spells.length - 1] === null) {
        player.spells.pop();
      }

      if (player.spells.length < 8 && !player.spells.includes(null)) {
        player.spells.push(null);
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    delete gameState.players[socket.id];
  });
});

// Статические файлы
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});