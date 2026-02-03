const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Конфигурация игры
const CONFIG = {
  FIELD_SIZE: 21,
  CELL_SIZE: 40,
  BLOCK_DURABILITY: 5,
  BLOCK_RESPAWN_TIME: 10000, // 10 секунд
  PLAYER_HP: 10,
  SPELL_SPEED: 300, // пикселей в секунду
  VIEW_RADIUS: 10,
};

// Игровое состояние
let gameState = {
  players: new Map(),
  blocks: new Map(),
  spells: new Map(),
  gameId: Date.now(),
};

// Генерация игрового поля
function generateField() {
  const blocks = new Map();

  // Несокрушимые стены по периметру
  for (let x = 0; x < CONFIG.FIELD_SIZE; x++) {
    for (let y = 0; y < CONFIG.FIELD_SIZE; y++) {
      if (x === 0 || y === 0 || x === CONFIG.FIELD_SIZE - 1 || y === CONFIG.FIELD_SIZE - 1) {
        blocks.set(`${x},${y}`, {
          type: 'wall',
          durability: Infinity
        });
      }
      // Шахматный порядок внутренних стен
      else if (x % 2 === 0 && y % 2 === 0) {
        blocks.set(`${x},${y}`, {
          type: 'wall',
          durability: Infinity
        });
      }
    }
  }

  // Разрушаемые блоки (30% свободных клеток)
  const freeCells = [];
  for (let x = 1; x < CONFIG.FIELD_SIZE - 1; x++) {
    for (let y = 1; y < CONFIG.FIELD_SIZE - 1; y++) {
      if (!blocks.has(`${x},${y}`) &&
        !(x % 2 === 0 && y % 2 === 0)) {
        freeCells.push({
          x,
          y
        });
      }
    }
  }

  const blockCount = Math.floor(freeCells.length * 0.3);
  for (let i = 0; i < blockCount; i++) {
    const randomIndex = Math.floor(Math.random() * freeCells.length);
    const cell = freeCells[randomIndex];
    blocks.set(`${cell.x},${cell.y}`, {
      type: 'destructible',
      durability: CONFIG.BLOCK_DURABILITY,
      id: `block_${Date.now()}_${i}`
    });
    freeCells.splice(randomIndex, 1);
  }

  return blocks;
}

// Инициализация поля
gameState.blocks = generateField();

// Таймер респавна блоков
setInterval(() => {
  const freeCells = [];
  for (let x = 1; x < CONFIG.FIELD_SIZE - 1; x++) {
    for (let y = 1; y < CONFIG.FIELD_SIZE - 1; y++) {
      const key = `${x},${y}`;
      if (!gameState.blocks.has(key) &&
        !(x % 2 === 0 && y % 2 === 0)) {
        freeCells.push({
          x,
          y
        });
      }
    }
  }

  if (freeCells.length > 0) {
    const randomIndex = Math.floor(Math.random() * freeCells.length);
    const cell = freeCells[randomIndex];
    const key = `${cell.x},${cell.y}`;

    if (!Array.from(gameState.players.values()).some(p =>
        Math.floor(p.x) === cell.x && Math.floor(p.y) === cell.y)) {

      gameState.blocks.set(key, {
        type: 'destructible',
        durability: CONFIG.BLOCK_DURABILITY,
        id: `block_${Date.now()}`
      });

      io.emit('block_added', {
        x: cell.x,
        y: cell.y,
        block: gameState.blocks.get(key)
      });
    }
  }
}, CONFIG.BLOCK_RESPAWN_TIME);

// Функция для получения свободной стартовой позиции
function getStartPosition() {
  const positions = [{
      x: 1,
      y: 1
    },
    {
      x: CONFIG.FIELD_SIZE - 2,
      y: 1
    },
    {
      x: 1,
      y: CONFIG.FIELD_SIZE - 2
    },
    {
      x: CONFIG.FIELD_SIZE - 2,
      y: CONFIG.FIELD_SIZE - 2
    },
  ];

  for (const pos of positions) {
    const key = `${pos.x},${pos.y}`;
    if (!gameState.blocks.has(key) &&
      !Array.from(gameState.players.values()).some(p =>
        Math.floor(p.x) === pos.x && Math.floor(p.y) === pos.y)) {
      return pos;
    }
  }

  // Если все заняты, ищем случайную свободную клетку
  for (let i = 0; i < 100; i++) {
    const x = Math.floor(Math.random() * (CONFIG.FIELD_SIZE - 2)) + 1;
    const y = Math.floor(Math.random() * (CONFIG.FIELD_SIZE - 2)) + 1;
    const key = `${x},${y}`;

    if (!gameState.blocks.has(key) &&
      !(x % 2 === 0 && y % 2 === 0) &&
      !Array.from(gameState.players.values()).some(p =>
        Math.floor(p.x) === x && Math.floor(p.y) === y)) {
      return {
        x,
        y
      };
    }
  }

  return {
    x: 1,
    y: 1
  };
}

// Статичные файлы
app.use(express.static(path.join(__dirname, 'public')));

// Socket.IO обработчики
io.on('connection', (socket) => {
  console.log('Новое подключение:', socket.id);

  // Инициализация игрока
  const startPos = getStartPosition();
  const player = {
    id: socket.id,
    nickname: `Игрок_${socket.id.slice(0, 4)}`,
    x: startPos.x,
    y: startPos.y,
    direction: 'down',
    hp: CONFIG.PLAYER_HP,
    maxHp: CONFIG.PLAYER_HP,
    shield: 0,
    score: 0,
    isCasting: false,
    castProgress: 0,
    selectedSpell: 0,
    spells: [{
        type: 'water',
        speed: 6,
        power: 5,
        name: '💧 Водяной выстрел'
      },
      {
        type: 'shield',
        speed: 6,
        power: 5,
        name: '🛡️ Щит'
      },
      null // Пустой слот
    ],
    lastMove: Date.now(),
    color: `hsl(${Math.random() * 360}, 70%, 60%)`
  };

  gameState.players.set(socket.id, player);

  // Отправляем начальное состояние новому игроку
  socket.emit('init', {
    player,
    gameState: {
      players: Array.from(gameState.players.values()),
      blocks: Array.from(gameState.blocks.entries()),
      fieldSize: CONFIG.FIELD_SIZE,
      cellSize: CONFIG.CELL_SIZE
    }
  });

  // Уведомляем других игроков
  socket.broadcast.emit('player_joined', player);

  // Обработка движения
  socket.on('move', (data) => {
    const player = gameState.players.get(socket.id);
    if (!player || player.hp <= 0) return;

    const {
      direction
    } = data;
    let newX = player.x;
    let newY = player.y;

    switch (direction) {
      case 'up':
        newY -= 1;
        player.direction = 'up';
        break;
      case 'down':
        newY += 1;
        player.direction = 'down';
        break;
      case 'left':
        newX -= 1;
        player.direction = 'left';
        break;
      case 'right':
        newX += 1;
        player.direction = 'right';
        break;
    }

    // Проверка коллизий
    const cellX = Math.floor(newX);
    const cellY = Math.floor(newY);
    const blockKey = `${cellX},${cellY}`;
    const block = gameState.blocks.get(blockKey);

    if (block && block.type === 'wall') {
      return; // Непроходимая стена
    }

    // Проверка на выход за границы
    if (newX < 0.5 || newX > CONFIG.FIELD_SIZE - 1.5 ||
      newY < 0.5 || newY > CONFIG.FIELD_SIZE - 1.5) {
      return;
    }

    // Проверка на столкновение с другими игроками
    const collidesWithPlayer = Array.from(gameState.players.values())
      .some(p => p.id !== socket.id &&
        Math.floor(p.x) === cellX &&
        Math.floor(p.y) === cellY);

    if (collidesWithPlayer) {
      return;
    }

    player.x = newX;
    player.y = newY;
    player.lastMove = Date.now();

    io.emit('player_moved', {
      id: socket.id,
      x: player.x,
      y: player.y,
      direction: player.direction
    });
  });

  // Обработка каста заклинания
  socket.on('cast_spell', (data) => {
    const player = gameState.players.get(socket.id);
    if (!player || player.hp <= 0 || player.isCasting) return;

    const {
      spellIndex
    } = data;
    const spell = player.spells[spellIndex];
    if (!spell) return;

    player.isCasting = true;
    player.castProgress = 0;
    player.selectedSpell = spellIndex;

    // Анимация каста
    const castTime = spell.speed * 100; // 2 очка = 1 секунда

    io.emit('casting_started', {
      playerId: socket.id,
      spellIndex,
      castTime
    });

    const castInterval = setInterval(() => {
      player.castProgress += 100 / (castTime / 100);

      io.emit('casting_progress', {
        playerId: socket.id,
        progress: player.castProgress
      });

      if (player.castProgress >= 100) {
        clearInterval(castInterval);
        player.isCasting = false;

        // Создание заклинания
        const spellId = `spell_${Date.now()}_${socket.id}`;
        const spellData = {
          id: spellId,
          type: spell.type,
          ownerId: socket.id,
          x: player.x,
          y: player.y,
          direction: player.direction,
          power: spell.power,
          speed: CONFIG.SPELL_SPEED,
          distance: 0,
          maxDistance: spell.power * 3
        };

        gameState.spells.set(spellId, spellData);

        // Запуск движения заклинания
        moveSpell(spellId);

        // Применение щита
        if (spell.type === 'shield') {
          player.shield = spell.power * 2; // Щит = сила * 2 HP
          io.emit('player_updated', {
            id: socket.id,
            shield: player.shield
          });
        }

        io.emit('spell_cast', {
          playerId: socket.id,
          spell: spellData
        });
      }
    }, 100);
  });

  // Функция движения заклинания
  function moveSpell(spellId) {
    const spell = gameState.spells.get(spellId);
    if (!spell) return;

    const moveInterval = setInterval(() => {
      if (!gameState.spells.has(spellId)) {
        clearInterval(moveInterval);
        return;
      }

      let newX = spell.x;
      let newY = spell.y;

      switch (spell.direction) {
        case 'up':
          newY -= 0.1;
          break;
        case 'down':
          newY += 0.1;
          break;
        case 'left':
          newX -= 0.1;
          break;
        case 'right':
          newX += 0.1;
          break;
      }

      spell.x = newX;
      spell.y = newY;
      spell.distance += 0.1;

      // Проверка столкновений
      const cellX = Math.floor(newX);
      const cellY = Math.floor(newY);

      // Стена
      const wallKey = `${cellX},${cellY}`;
      const wallBlock = gameState.blocks.get(wallKey);
      if (wallBlock && wallBlock.type === 'wall') {
        io.emit('spell_hit', {
          spellId,
          target: 'wall',
          x: cellX,
          y: cellY
        });
        gameState.spells.delete(spellId);
        clearInterval(moveInterval);
        return;
      }

      // Разрушаемый блок
      if (wallBlock && wallBlock.type === 'destructible') {
        const damage = Math.max(spell.power - Math.floor(spell.distance), 1);
        wallBlock.durability -= damage;

        io.emit('spell_hit', {
          spellId,
          target: 'block',
          x: cellX,
          y: cellY,
          damage,
          remainingDurability: wallBlock.durability
        });

        if (wallBlock.durability <= 0) {
          gameState.blocks.delete(wallKey);

          // Начисление очков
          const owner = gameState.players.get(spell.ownerId);
          if (owner) {
            owner.score += 10;
            io.emit('player_updated', {
              id: owner.id,
              score: owner.score
            });
          }
        }

        // Уменьшение силы заклинания
        spell.power -= damage;
        if (spell.power <= 0) {
          gameState.spells.delete(spellId);
          clearInterval(moveInterval);
          return;
        }
      }

      // Игроки
      Array.from(gameState.players.values()).forEach(targetPlayer => {
        if (targetPlayer.id === spell.ownerId) return; // Не попадаем в себя
        if (targetPlayer.hp <= 0) return;

        const distance = Math.sqrt(
          Math.pow(newX - targetPlayer.x, 2) +
          Math.pow(newY - targetPlayer.y, 2)
        );

        if (distance < 0.5) { // Попадание
          const damage = Math.max(spell.power - Math.floor(spell.distance), 1);

          // Сначала щит
          if (targetPlayer.shield > 0) {
            const shieldDamage = Math.min(targetPlayer.shield, damage);
            targetPlayer.shield -= shieldDamage;
            remainingDamage = damage - shieldDamage;
          } else {
            remainingDamage = damage;
          }

          // Затем HP
          if (remainingDamage > 0) {
            targetPlayer.hp = Math.max(0, targetPlayer.hp - remainingDamage);
          }

          io.emit('player_hit', {
            targetId: targetPlayer.id,
            damage,
            newHp: targetPlayer.hp,
            newShield: targetPlayer.shield,
            attackerId: spell.ownerId
          });

          // Начисление очков за попадание
          const owner = gameState.players.get(spell.ownerId);
          if (owner && remainingDamage > 0) {
            owner.score += remainingDamage * 5;
            io.emit('player_updated', {
              id: owner.id,
              score: owner.score
            });
          }

          // Смерть игрока
          if (targetPlayer.hp <= 0) {
            targetPlayer.hp = 0;
            io.emit('player_died', {
              playerId: targetPlayer.id,
              killerId: spell.ownerId
            });

            // Возрождение через 3 секунды
            setTimeout(() => {
              if (gameState.players.has(targetPlayer.id)) {
                const startPos = getStartPosition();
                targetPlayer.x = startPos.x;
                targetPlayer.y = startPos.y;
                targetPlayer.hp = CONFIG.PLAYER_HP;
                targetPlayer.shield = 0;
                // Сохраняем ник, настройки, но сбрасываем очки
                const scoreToAdd = targetPlayer.score;
                targetPlayer.score = 0;

                io.emit('player_respawned', {
                  id: targetPlayer.id,
                  x: targetPlayer.x,
                  y: targetPlayer.y,
                  hp: targetPlayer.hp
                });

                // Начисление очков убийце
                const killer = gameState.players.get(spell.ownerId);
                if (killer) {
                  killer.score += scoreToAdd;
                  io.emit('player_updated', {
                    id: killer.id,
                    score: killer.score
                  });
                }
              }
            }, 3000);
          }

          gameState.spells.delete(spellId);
          clearInterval(moveInterval);
        }
      });

      // Максимальная дистанция
      if (spell.distance >= spell.maxDistance) {
        io.emit('spell_disappeared', {
          spellId
        });
        gameState.spells.delete(spellId);
        clearInterval(moveInterval);
      } else {
        io.emit('spell_moved', {
          spellId,
          x: spell.x,
          y: spell.y
        });
      }
    }, 50);
  }

  // Редактирование никнейма
  socket.on('update_nickname', (data) => {
    const player = gameState.players.get(socket.id);
    if (player && data.nickname && data.nickname.trim().length > 0) {
      player.nickname = data.nickname.substring(0, 15);
      io.emit('player_updated', {
        id: socket.id,
        nickname: player.nickname
      });
    }
  });

  // Редактирование заклинания
  socket.on('update_spell', (data) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;

    const {
      spellIndex,
      type,
      speed,
      power
    } = data;

    // Проверка диапазонов
    if (speed < 1 || speed > 10 || power < 1 || power > 10) return;

    if (spellIndex < player.spells.length) {
      player.spells[spellIndex] = {
        type,
        speed,
        power,
        name: type === 'water' ? '💧 Водяной выстрел' : '🛡️ Щит'
      };

      // Автоматическое добавление нового слота
      if (spellIndex === player.spells.length - 1 && player.spells.length < 8) {
        player.spells.push(null);
      }

      io.emit('player_updated', {
        id: socket.id,
        spells: player.spells
      });
    }
  });

  // Удаление заклинания
  socket.on('remove_spell', (data) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;

    const {
      spellIndex
    } = data;
    if (spellIndex < player.spells.length && player.spells[spellIndex]) {
      player.spells[spellIndex] = null;

      io.emit('player_updated', {
        id: socket.id,
        spells: player.spells
      });
    }
  });

  // Выбор заклинания
  socket.on('select_spell', (data) => {
    const player = gameState.players.get(socket.id);
    if (player) {
      player.selectedSpell = data.spellIndex;
      io.emit('player_updated', {
        id: socket.id,
        selectedSpell: player.selectedSpell
      });
    }
  });

  // Отключение игрока
  socket.on('disconnect', () => {
    console.log('Отключение:', socket.id);
    gameState.players.delete(socket.id);
    io.emit('player_left', {
      id: socket.id
    });
  });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Откройте http://localhost:${PORT} в браузере`);
});