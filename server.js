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
const RESPAWN_TIME = 3000; // 3 секунды
const BLOCK_RESPAWN_INTERVAL = 10000; // 10 секунд

// Игровое состояние
let gameState = {
  players: {},
  spells: [],
  blocks: [],
  lastBlockRespawn: Date.now()
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

  // Если не нашли случайную позицию, возвращаем центр
  return {
    x: Math.floor(GRID_SIZE / 2) + 0.5,
    y: Math.floor(GRID_SIZE / 2) + 0.5
  };
}

// Проверить коллизии
function checkCollision(x, y, ignorePlayerId = null) {
  // Проверить границы карты
  if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) {
    return true;
  }

  // Проверить блоки
  const block = gameState.blocks.find(b =>
    Math.floor(b.x) === Math.floor(x) && Math.floor(b.y) === Math.floor(y)
  );

  if (block && !block.indestructible && block.hp > 0) {
    return true;
  }

  // Проверить других игроков
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

// Обновить блоки (респавн каждые 10 секунд)
function updateBlocks() {
  const now = Date.now();
  if (now - gameState.lastBlockRespawn >= BLOCK_RESPAWN_INTERVAL) {
    // Удалить разрушенные блоки
    gameState.blocks = gameState.blocks.filter(block =>
      block.indestructible || block.hp > 0
    );

    // Добавить новые блоки в случайные свободные клетки
    const emptyCells = [];
    for (let x = 2; x < GRID_SIZE - 2; x++) {
      for (let y = 2; y < GRID_SIZE - 2; y++) {
        if ((x % 2 !== 0 || y % 2 !== 0) &&
          !gameState.blocks.some(b => b.x === x && b.y === y) &&
          !Object.values(gameState.players).some(p =>
            Math.floor(p.x) === x && Math.floor(p.y) === y
          )) {
          emptyCells.push({
            x,
            y
          });
        }
      }
    }

    // Добавить блоки в 30% свободных клеток
    const blocksToAdd = Math.floor(emptyCells.length * 0.3);
    for (let i = 0; i < blocksToAdd; i++) {
      if (emptyCells.length > 0) {
        const index = Math.floor(Math.random() * emptyCells.length);
        const cell = emptyCells.splice(index, 1)[0];
        gameState.blocks.push({
          x: cell.x,
          y: cell.y,
          hp: BLOCK_HP,
          indestructible: false
        });
      }
    }

    gameState.lastBlockRespawn = now;
  }
}

// Инициализировать карту
gameState.blocks = generateMap();

// Интервал обновления игры
setInterval(() => {
  updateBlocks();

  // Обновить заклинания
  gameState.spells = gameState.spells.filter(spell => {
    // Движение заклинания
    spell.x += Math.cos(spell.direction) * 0.1;
    spell.y += Math.sin(spell.direction) * 0.1;
    spell.distance += 0.1;

    // Уменьшение урона с расстоянием
    spell.currentDamage = Math.max(0, spell.power - Math.floor(spell.distance));

    // Проверить выход за границы
    if (spell.x < 0 || spell.x >= GRID_SIZE || spell.y < 0 || spell.y >= GRID_SIZE) {
      return false;
    }

    // Проверить попадание в блок
    const block = gameState.blocks.find(b =>
      Math.floor(b.x) === Math.floor(spell.x) &&
      Math.floor(b.y) === Math.floor(spell.y) &&
      !b.indestructible &&
      b.hp > 0
    );

    if (block) {
      block.hp -= spell.currentDamage;
      if (block.hp <= 0) {
        // Начислить очки за разрушение блока
        if (gameState.players[spell.casterId]) {
          gameState.players[spell.casterId].score += 10;
        }
      }
      return false;
    }

    // Проверить попадание в игрока
    for (const [id, player] of Object.entries(gameState.players)) {
      if (id !== spell.casterId &&
        player.hp > 0 &&
        Math.floor(player.x) === Math.floor(spell.x) &&
        Math.floor(player.y) === Math.floor(spell.y)) {

        const damage = spell.currentDamage;

        // Сначала тратится щит
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

        // Начислить очки за попадание
        if (gameState.players[spell.casterId]) {
          gameState.players[spell.casterId].score += damage * 5;
        }

        // Если игрок убит
        if (player.hp <= 0) {
          player.respawnTime = Date.now() + RESPAWN_TIME;

          // Начислить очки за убийство
          if (gameState.players[spell.casterId]) {
            gameState.players[spell.casterId].score += player.score;
            player.score = 0;
          }
        }

        return false;
      }
    }

    // Максимальная дистанция
    return spell.distance < spell.power * 2;
  });

  // Проверить респавн игроков
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

  // Отправить обновленное состояние всем клиентам
  io.emit('gameState', gameState);
}, 50); // 20 FPS

// Обработка подключений Socket.IO
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Инициализация нового игрока
  const spawnPos = getRandomSpawnPosition();
  gameState.players[socket.id] = {
    id: socket.id,
    x: spawnPos.x,
    y: spawnPos.y,
    direction: 0,
    hp: INITIAL_PLAYER_HP,
    shield: 0,
    score: 0,
    nickname: `Player${Math.floor(Math.random() * 1000)}`,
    spells: [{
        type: 'water',
        speed: 5,
        power: 6
      },
      {
        type: 'shield',
        speed: 3,
        power: 8
      },
      null // Пустой слот
    ],
    casting: null,
    lastCastTime: 0
  };

  // Отправить текущее состояние новому игроку
  socket.emit('init', {
    playerId: socket.id,
    gridSize: GRID_SIZE,
    cellSize: CELL_SIZE
  });
  socket.emit('gameState', gameState);

  // Движение игрока
  socket.on('move', (direction) => {
    const player = gameState.players[socket.id];
    if (!player || player.hp <= 0) return;

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

    // Проверить коллизию
    if (!checkCollision(newX, newY, socket.id)) {
      player.x = newX;
      player.y = newY;

      // Обновить направление
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
    }
  });

  // Каст заклинания
  socket.on('castSpell', ({
    spellIndex
  }) => {
    const player = gameState.players[socket.id];
    if (!player || player.hp <= 0 || !player.spells[spellIndex]) return;

    const spell = player.spells[spellIndex];
    const now = Date.now();

    // Проверить кулдаун
    if (now - player.lastCastTime < spell.speed * 100) {
      return;
    }

    player.casting = {
      index: spellIndex,
      startTime: now,
      duration: spell.speed * 100
    };
    player.lastCastTime = now;

    // Если это щит - сразу применить
    if (spell.type === 'shield') {
      setTimeout(() => {
        player.shield = spell.power * 2;
        player.casting = null;
      }, spell.speed * 100);
    }
  });

  // Завершение каста (для водяного выстрела)
  socket.on('castComplete', () => {
    const player = gameState.players[socket.id];
    if (!player || !player.casting || player.hp <= 0) return;

    const spell = player.spells[player.casting.index];
    if (spell.type === 'water') {
      // Создать заклинание
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
    }

    player.casting = null;
  });

  // Обновление никнейма
  socket.on('updateNickname', (nickname) => {
    if (gameState.players[socket.id]) {
      gameState.players[socket.id].nickname = nickname.substring(0, 20);
    }
  });

  // Обновление заклинаний
  socket.on('updateSpell', ({
    index,
    spell
  }) => {
    const player = gameState.players[socket.id];
    if (player && index >= 0 && index < 8) {
      if (!player.spells[index]) {
        player.spells[index] = spell;
        // Добавить пустой слот, если заполнен последний
        if (index === player.spells.length - 1 && player.spells.length < 8) {
          player.spells.push(null);
        }
      } else {
        player.spells[index] = spell;
      }
    }
  });

  // Удаление заклинания
  socket.on('removeSpell', (index) => {
    const player = gameState.players[socket.id];
    if (player && player.spells[index]) {
      player.spells[index] = null;
      // Убрать пустые слоты в конце
      while (player.spells.length > 0 && !player.spells[player.spells.length - 1]) {
        player.spells.pop();
      }
      // Всегда оставить хотя бы один пустой слот
      if (player.spells.length < 8 && (!player.spells[player.spells.length - 1] || player.spells.length === 0)) {
        player.spells.push(null);
      }
    }
  });

  // Отключение игрока
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
});