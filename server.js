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
const BLOCK_HP = 5; // Прочность блоков
const INITIAL_BLOCKS_PERCENT = 0.3; // 30% поля
const BLOCK_RESPAWN_INTERVAL = 45000; // 45 секунд (рассчитано ниже)
const INITIAL_PLAYER_HP = 10;
const PLAYER_RESPAWN_TIME = 3000; // 3 секунды

// Расчет частоты респавна блоков:
// Свободных клеток на пустом поле: 21x21 = 441 клеток
// Минус несокрушимые стены: по периметру 21*4-4=80 клеток + внутренние 10*10=100 клеток = 180 клеток
// Остается 441-180 = 261 свободных клеток
// Заполнение за 15 минут (900 секунд): 261/900 ≈ 0.29 блока в секунду
// Интервал: 1000/0.29 ≈ 3448ms, возьмем 45 секунд для более медленного заполнения

const BRIGHT_COLORS = [
  '#FF5252', '#FF4081', '#E040FB', '#7C4DFF', '#536DFE',
  '#448AFF', '#40C4FF', '#18FFFF', '#64FFDA', '#69F0AE'
];

// Списки для генерации имен
const ADJECTIVES = [
  'Swift', 'Mighty', 'Silent', 'Brave', 'Clever', 'Wise', 'Fierce', 'Noble',
  'Ancient', 'Golden', 'Shadow', 'Crystal', 'Iron', 'Storm', 'Fire'
];

const ANIMALS = [
  'Fox', 'Wolf', 'Eagle', 'Bear', 'Tiger', 'Lion', 'Dragon', 'Phoenix',
  'Griffin', 'Panther', 'Raven', 'Falcon', 'Shark', 'Serpent', 'Spider'
];

// Хранение данных
const players = new Map();
const spells = [];
const blocks = new Map(); // Map для хранения блоков с HP
let field = generateField();
let lastBlockRespawn = Date.now();

function generateField() {
  const field = Array(FIELD_SIZE).fill().map(() => Array(FIELD_SIZE).fill(0));

  // Несокрушимые стены по периметру
  for (let i = 0; i < FIELD_SIZE; i++) {
    for (let j = 0; j < FIELD_SIZE; j++) {
      // Стены по краям
      if (i === 0 || j === 0 || i === FIELD_SIZE - 1 || j === FIELD_SIZE - 1) {
        field[i][j] = 1;
      }
      // Шахматный порядок внутренних стен
      else if (i % 2 === 0 && j % 2 === 0) {
        field[i][j] = 1;
      }
    }
  }

  // Разрушаемые блоки (30% свободных клеток)
  const totalFreeCells = (FIELD_SIZE - 2) * (FIELD_SIZE - 2) - Math.floor((FIELD_SIZE - 2) / 2) * Math.floor((FIELD_SIZE - 2) / 2);
  const blocksToPlace = Math.floor(totalFreeCells * INITIAL_BLOCKS_PERCENT);
  let placed = 0;

  while (placed < blocksToPlace) {
    const x = Math.floor(Math.random() * (FIELD_SIZE - 2)) + 1;
    const y = Math.floor(Math.random() * (FIELD_SIZE - 2)) + 1;

    // Пропускаем стены и углы для спавна
    if (field[x][y] === 0 &&
      !(x <= 2 && y <= 2) &&
      !(x >= FIELD_SIZE - 3 && y >= FIELD_SIZE - 3) &&
      !(x <= 2 && y >= FIELD_SIZE - 3) &&
      !(x >= FIELD_SIZE - 3 && y <= 2)) {

      field[x][y] = 2;
      blocks.set(`${x},${y}`, {
        hp: BLOCK_HP,
        x,
        y
      });
      placed++;
    }
  }

  return field;
}

function findEmptySpot() {
  const emptySpots = [];
  for (let x = 1; x < FIELD_SIZE - 1; x++) {
    for (let y = 1; y < FIELD_SIZE - 1; y++) {
      if (field[x][y] === 0) {
        // Проверяем, нет ли игрока в этой клетке
        let hasPlayer = false;
        players.forEach(player => {
          if (Math.floor(player.x) === x && Math.floor(player.y) === y) {
            hasPlayer = true;
          }
        });

        if (!hasPlayer) {
          emptySpots.push({
            x,
            y
          });
        }
      }
    }
  }

  if (emptySpots.length === 0) {
    return {
      x: Math.floor(FIELD_SIZE / 2),
      y: Math.floor(FIELD_SIZE / 2)
    };
  }

  return emptySpots[Math.floor(Math.random() * emptySpots.length)];
}

function getRandomNickname() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const num = Math.floor(Math.random() * 100);
  return `${adj}${animal}${num}`;
}

function getRandomColor() {
  return BRIGHT_COLORS[Math.floor(Math.random() * BRIGHT_COLORS.length)];
}

function respawnBlocks() {
  const now = Date.now();
  if (now - lastBlockRespawn < BLOCK_RESPAWN_INTERVAL) return;

  const emptySpots = [];
  for (let x = 1; x < FIELD_SIZE - 1; x++) {
    for (let y = 1; y < FIELD_SIZE - 1; y++) {
      if (field[x][y] === 0) {
        // Проверяем, нет ли игрока в этой клетке
        let hasPlayer = false;
        players.forEach(player => {
          if (Math.floor(player.x) === x && Math.floor(player.y) === y) {
            hasPlayer = true;
          }
        });

        if (!hasPlayer) {
          emptySpots.push({
            x,
            y
          });
        }
      }
    }
  }

  // Добавляем только 1 блок за раз для медленного заполнения
  if (emptySpots.length > 0) {
    const spot = emptySpots[Math.floor(Math.random() * emptySpots.length)];
    field[spot.x][spot.y] = 2;
    blocks.set(`${spot.x},${spot.y}`, {
      hp: BLOCK_HP,
      x: spot.x,
      y: spot.y
    });
    io.emit('blockRespawned', {
      x: spot.x,
      y: spot.y,
      hp: BLOCK_HP
    });
  }

  lastBlockRespawn = now;
}

app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  const spawn = findEmptySpot();
  const playerData = {
    id: socket.id,
    nickname: getRandomNickname(),
    color: getRandomColor(),
    x: spawn.x + 0.5, // Центр клетки
    y: spawn.y + 0.5, // Центр клетки
    direction: 'down',
    score: 0,
    hp: INITIAL_PLAYER_HP,
    shield: 0,
    spells: [{
        type: 'water',
        speed: 5,
        power: 6,
        selected: true
      },
      {
        type: 'shield',
        speed: 5,
        power: 6,
        selected: false
      },
      null, null, null, null, null, null
    ],
    respawnTime: 0
  };

  players.set(socket.id, playerData);

  socket.emit('init', {
    id: socket.id,
    nickname: playerData.nickname,
    color: playerData.color,
    field,
    fieldSize: FIELD_SIZE,
    tileSize: TILE_SIZE,
    allPlayers: Object.fromEntries(players),
    allSpells: spells,
    blocks: Array.from(blocks.values())
  });

  io.emit('playerJoined', playerData);

  socket.on('move', (direction) => {
    const player = players.get(socket.id);
    if (!player || player.hp <= 0) return;

    // Поворачиваем игрока всегда
    player.direction = direction;
    io.emit('playerUpdated', player);

    let newX = player.x;
    let newY = player.y;

    if (direction === 'up') newY -= 1;
    if (direction === 'down') newY += 1;
    if (direction === 'left') newX -= 1;
    if (direction === 'right') newX += 1;

    const cellX = Math.floor(newX);
    const cellY = Math.floor(newY);

    // Проверяем границы и препятствия
    if (cellX >= 0 && cellX < FIELD_SIZE && cellY >= 0 && cellY < FIELD_SIZE) {
      // Проверяем стену или блок
      if (field[cellX][cellY] === 0) {
        // Проверяем других игроков
        let canMove = true;
        players.forEach(otherPlayer => {
          if (otherPlayer.id !== socket.id &&
            otherPlayer.hp > 0 &&
            Math.floor(otherPlayer.x) === cellX &&
            Math.floor(otherPlayer.y) === cellY) {
            canMove = false;
          }
        });

        if (canMove) {
          player.x = newX;
          player.y = newY;
          io.emit('playerMoved', {
            id: socket.id,
            x: player.x,
            y: player.y,
            direction
          });
        }
      }
    }
  });

  socket.on('updateSpell', (data) => {
    const player = players.get(socket.id);
    if (!player || data.index < 0 || data.index >= 8) return;

    if (data.type) {
      // Сохраняем заклинание
      player.spells[data.index] = {
        type: data.type,
        speed: data.speed,
        power: data.power,
        selected: data.selected || false
      };

      // Если это выбранное заклинание, снимаем выделение с других
      if (data.selected) {
        player.spells.forEach((spell, i) => {
          if (spell && i !== data.index) spell.selected = false;
        });
      }

      // Добавляем новый пустой слот в конец, если это последний заполненный
      const lastFilledIndex = player.spells.findIndex(slot => slot === null);
      if (lastFilledIndex === -1 && player.spells.length < 8) {
        player.spells.push(null);
      }
    } else {
      // Удаляем заклинание
      player.spells[data.index] = null;

      // Удаляем пустые слоты в конце
      while (player.spells.length > 0 && player.spells[player.spells.length - 1] === null) {
        player.spells.pop();
      }

      // Всегда оставляем хотя бы один пустой слот
      if (player.spells.length === 0 || (player.spells[player.spells.length - 1] !== null && player.spells.length < 8)) {
        player.spells.push(null);
      }

      // Выбираем первое доступное заклинание
      const firstSpellIndex = player.spells.findIndex(spell => spell !== null);
      if (firstSpellIndex !== -1) {
        player.spells.forEach((spell, i) => {
          if (spell) spell.selected = (i === firstSpellIndex);
        });
      }
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
    if (!player || player.hp <= 0) return;

    const selectedSpell = player.spells.find(s => s && s.selected);
    if (!selectedSpell) return;

    if (selectedSpell.type === 'shield') {
      player.shield = selectedSpell.power * 2;
      io.emit('playerUpdated', player);
      return;
    }

    let targetX = player.x;
    let targetY = player.y;
    const direction = player.direction;
    const maxDistance = selectedSpell.power * 2;

    // Ищем точку попадания
    for (let distance = 0; distance < maxDistance; distance++) {
      if (direction === 'up') targetY -= 0.1;
      if (direction === 'down') targetY += 0.1;
      if (direction === 'left') targetX -= 0.1;
      if (direction === 'right') targetX += 0.1;

      const cellX = Math.floor(targetX);
      const cellY = Math.floor(targetY);

      if (cellX < 0 || cellX >= FIELD_SIZE || cellY < 0 || cellY >= FIELD_SIZE) {
        break;
      }

      // Если стена - останавливаемся сразу
      if (field[cellX][cellY] === 1) {
        break;
      }

      // Если блок - проверяем, можно ли пролететь дальше
      if (field[cellX][cellY] === 2) {
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
      direction,
      progress: 0,
      damage: selectedSpell.power, // Начальный урон
      distance: 0
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
    blocks.clear();

    // Восстанавливаем блоки из нового поля
    for (let x = 1; x < FIELD_SIZE - 1; x++) {
      for (let y = 1; y < FIELD_SIZE - 1; y++) {
        if (field[x][y] === 2) {
          blocks.set(`${x},${y}`, {
            hp: BLOCK_HP,
            x,
            y
          });
        }
      }
    }

    io.emit('fieldReset', {
      field,
      blocks: Array.from(blocks.values())
    });

    // Перемещаем всех игроков в безопасные места
    players.forEach((player, id) => {
      const spawn = findEmptySpot();
      player.x = spawn.x + 0.5;
      player.y = spawn.y + 0.5;
      player.hp = INITIAL_PLAYER_HP;
      player.shield = 0;

      io.emit('playerMoved', {
        id,
        x: player.x,
        y: player.y,
        direction: player.direction
      });
      io.emit('playerUpdated', player);
    });
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    players.delete(socket.id);
    io.emit('playerLeft', socket.id);
  });
});

function gameLoop() {
  // Респавн блоков
  respawnBlocks();

  // Обновление заклинаний
  for (let i = spells.length - 1; i >= 0; i--) {
    const spell = spells[i];

    // Скорость движения: 0.05 клетки за тик * скорость заклинания
    spell.progress += 0.05 * spell.speed;
    spell.distance += 0.05 * spell.speed;

    // Уменьшение урона с расстоянием
    spell.damage = Math.max(0, spell.power - Math.floor(spell.distance));

    // Вычисляем текущую позицию
    const currentX = spell.x + (spell.targetX - spell.x) * spell.progress;
    const currentY = spell.y + (spell.targetY - spell.y) * spell.progress;

    const cellX = Math.floor(currentX);
    const cellY = Math.floor(currentY);

    // Проверяем коллизии
    let shouldRemove = false;

    // Проверяем границы
    if (cellX < 0 || cellX >= FIELD_SIZE || cellY < 0 || cellY >= FIELD_SIZE) {
      shouldRemove = true;
    }

    // Проверяем стену
    if (!shouldRemove && field[cellX][cellY] === 1) {
      shouldRemove = true;
    }

    // Проверяем блок
    if (!shouldRemove && field[cellX][cellY] === 2) {
      const blockKey = `${cellX},${cellY}`;
      const block = blocks.get(blockKey);

      if (block && block.hp > 0) {
        block.hp -= spell.damage;

        if (block.hp <= 0) {
          // Уничтожаем блок
          field[cellX][cellY] = 0;
          blocks.delete(blockKey);

          // Начисляем очки
          const player = players.get(spell.playerId);
          if (player) {
            player.score += 10;
            io.emit('playerUpdated', player);
          }

          io.emit('blockDestroyed', {
            x: cellX,
            y: cellY
          });
        } else {
          // Обновляем HP блока
          io.emit('blockUpdated', {
            x: cellX,
            y: cellY,
            hp: block.hp
          });
        }

        shouldRemove = true;
      }
    }

    // Проверяем попадание в игрока
    if (!shouldRemove) {
      players.forEach((player, playerId) => {
        if (playerId !== spell.playerId &&
          player.hp > 0 &&
          Math.floor(currentX) === Math.floor(player.x) &&
          Math.floor(currentY) === Math.floor(player.y)) {

          // Наносим урон
          let damage = spell.damage;

          // Сначала тратится щит
          if (player.shield > 0) {
            const shieldDamage = Math.min(player.shield, damage);
            player.shield -= shieldDamage;
            damage -= shieldDamage;
          }

          if (damage > 0) {
            player.hp = Math.max(0, player.hp - damage);
          }

          // Начисляем очки за попадание
          const caster = players.get(spell.playerId);
          if (caster) {
            caster.score += spell.damage * 5;
            io.emit('playerUpdated', caster);
          }

          // Если игрок убит
          if (player.hp <= 0) {
            player.respawnTime = Date.now() + 3000;

            // Начисляем очки за убийство
            if (caster) {
              caster.score += player.score;
              player.score = 0;
            }
          }

          io.emit('playerUpdated', player);
          shouldRemove = true;
        }
      });
    }

    // Удаляем заклинание если нужно
    if (shouldRemove || spell.progress >= 1) {
      spells.splice(i, 1);
      if (shouldRemove) {
        io.emit('spellHit', {
          spellId: spell.id,
          x: cellX,
          y: cellY
        });
      }
    }
  }

  // Проверяем респавн игроков
  const now = Date.now();
  players.forEach((player, playerId) => {
    if (player.hp <= 0 && player.respawnTime && now >= player.respawnTime) {
      const spawn = findEmptySpot();
      player.x = spawn.x + 0.5;
      player.y = spawn.y + 0.5;
      player.hp = INITIAL_PLAYER_HP;
      player.shield = 0;
      player.respawnTime = 0;

      io.emit('playerMoved', {
        id: playerId,
        x: player.x,
        y: player.y,
        direction: player.direction
      });
      io.emit('playerUpdated', player);
    }
  });

  io.emit('spellsUpdate', spells);
}

// Игровой цикл (30 FPS)
setInterval(gameLoop, 1000 / 30);

http.listen(3000, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:3000`);
  console.log(`Field size: ${FIELD_SIZE}x${FIELD_SIZE}`);
  console.log(`Block HP: ${BLOCK_HP}`);
  console.log(`Block respawn interval: ${BLOCK_RESPAWN_INTERVAL/1000} seconds`);
});