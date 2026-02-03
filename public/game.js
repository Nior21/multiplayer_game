class MagicBomberman {
    constructor() {
        console.log('Initializing MagicBomberman...');
        this.socket = io();
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');

        this.playerId = null;
        this.gameState = null;
        this.gridSize = 21;
        this.cellSize = 40;
        this.scale = 1;
        this.offsetX = 0;
        this.offsetY = 0;

        // Инициализируем спрайты
        this.sprites = {
            loaded: false,
            floor: null,
            wall: null,
            block: null,
            blockCracked: null,
            player: null,
            waterSpell: null,
            shieldSpell: null
        };

        this.selectedSpellIndex = null;
        this.currentConfigSpellIndex = null;
        this.currentConfigSpellType = null;

        this.keys = {};
        this.touchPositions = {};
        this.pinchStartDistance = 0;
        this.pinchStartScale = 1;
        this.isDragging = false;
        this.lastDragX = 0;
        this.lastDragY = 0;

        this.init();
    }

    init() {
        console.log('Initializing game...');

        // Сначала создаем fallback спрайты
        this.createFallbackSprites();

        // Параллельно пытаемся загрузить из файлов
        this.loadSprites();

        this.setupCanvas();
        this.setupEventListeners();
        this.setupSocketListeners();

        console.log('Starting render loop...');
        this.render();
    }

    createFallbackSprites() {
        console.log('Creating fallback sprites...');

        const createSprite = (color, text = '') => {
            const canvas = document.createElement('canvas');
            canvas.width = 32;
            canvas.height = 32;
            const ctx = canvas.getContext('2d');

            // Фон
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 32, 32);

            // Граница
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.strokeRect(1, 1, 30, 30);

            // Текст
            if (text) {
                ctx.fillStyle = '#FFF';
                ctx.font = 'bold 14px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(text, 16, 16);
            }

            const img = new Image();
            img.src = canvas.toDataURL('image/png');
            return img;
        };

        // Создаем спрайты
        this.sprites = {
            loaded: true,
            floor: createSprite('#162447'),
            wall: createSprite('#393e46', 'W'),
            block: createSprite('#8B4513', 'B'),
            blockCracked: createSprite('#A0522D', 'C'),
            player: createSprite('#4ECCA3', 'P'),
            waterSpell: createSprite('#4D96FF', 'W'),
            shieldSpell: createSprite('#FFD700', 'S')
        };

        console.log('Fallback sprites created');
    }

    loadSprites() {
        console.log('Loading sprites from assets...');
        const spriteFiles = [{
                name: 'floor',
                file: 'floor.png'
            },
            {
                name: 'wall',
                file: 'wall.png'
            },
            {
                name: 'block',
                file: 'block.png'
            },
            {
                name: 'blockCracked',
                file: 'block_cracked.png'
            },
            {
                name: 'player',
                file: 'player.png'
            },
            {
                name: 'waterSpell',
                file: 'water_spell.png'
            },
            {
                name: 'shieldSpell',
                file: 'shield_spell.png'
            }
        ];

        let loadedCount = 0;

        spriteFiles.forEach(sprite => {
            const img = new Image();
            img.onload = () => {
                console.log(`Sprite loaded: ${sprite.file}`);
                this.sprites[sprite.name] = img;
                loadedCount++;
                console.log(`Загружен спрайт: ${sprite.file}`);

                if (loadedCount === spriteFiles.length) {
                    this.sprites.loaded = true;
                    console.log('All sprites loaded from assets');
                }
            };

            img.onerror = () => {
                console.log(`Failed to load: ${sprite.file}, using fallback`);
                loadedCount++;
            };

            img.src = `assets/${sprite.file}`;
        });
    }

    setupCanvas() {
        console.log('Setting up canvas...');
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    resizeCanvas() {
        console.log(`Resizing canvas to ${window.innerWidth}x${window.innerHeight}`);
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.centerOnPlayer();
    }

    setupEventListeners() {
        console.log('Setting up event listeners...');
        // Блокировка стандартного масштабирования браузера
        document.addEventListener('wheel', (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
            }
        }, {
            passive: false
        });

        document.addEventListener('keydown', (e) => {
            if (!this.keys[e.key]) {
                this.keys[e.key] = true;

                // Управление WASD
                if (e.key === 'w' || e.key === 'W' || e.key === 'ц' || e.key === 'Ц') {
                    e.preventDefault();
                    this.socket.emit('move', 'up');
                } else if (e.key === 'a' || e.key === 'A' || e.key === 'ф' || e.key === 'Ф') {
                    e.preventDefault();
                    this.socket.emit('move', 'left');
                } else if (e.key === 's' || e.key === 'S' || e.key === 'ы' || e.key === 'Ы') {
                    e.preventDefault();
                    this.socket.emit('move', 'down');
                } else if (e.key === 'd' || e.key === 'D' || e.key === 'в' || e.key === 'В') {
                    e.preventDefault();
                    this.socket.emit('move', 'right');
                }

                // Каст заклинания пробелом
                if (e.key === ' ' && this.selectedSpellIndex !== null) {
                    e.preventDefault();
                    this.castSpell();
                }

                // Изменение масштаба +/- (для тестирования)
                if (e.key === '+' || e.key === '=') {
                    e.preventDefault();
                    this.zoom(1.1);
                } else if (e.key === '-' || e.key === '_') {
                    e.preventDefault();
                    this.zoom(0.9);
                }
            }
        });

        document.addEventListener('keyup', (e) => {
            this.keys[e.key] = false;
        });

        // Управление джостиком
        document.querySelectorAll('.joy-btn').forEach(btn => {
            btn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const direction = btn.dataset.direction;
                this.socket.emit('move', direction);
            });

            btn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                const direction = btn.dataset.direction;
                this.socket.emit('move', direction);
            });
        });

        // Кнопка CAST
        document.getElementById('cast-btn').addEventListener('click', () => {
            console.log('CAST button clicked');
            this.castSpell();
        });

        document.getElementById('cast-btn').addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.castSpell();
        });

        // Изменение никнейма
        document.getElementById('nickname').addEventListener('blur', (e) => {
            this.socket.emit('updateNickname', e.target.textContent);
        });

        document.getElementById('nickname').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.target.blur();
            }
        });

        // Масштабирование колесиком мыши
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();

            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const worldX = (mouseX - this.offsetX) / this.scale;
            const worldY = (mouseY - this.offsetY) / this.scale;

            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            const newScale = Math.max(0.5, Math.min(3, this.scale * delta));

            if (newScale !== this.scale) {
                this.offsetX = mouseX - worldX * newScale;
                this.offsetY = mouseY - worldY * newScale;
                this.scale = newScale;
            }
        }, {
            passive: false
        });

        // Тач-жесты для масштабирования и перемещения
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();

            if (e.touches.length === 1) {
                this.isDragging = true;
                const touch = e.touches[0];
                this.lastDragX = touch.clientX;
                this.lastDragY = touch.clientY;
            } else if (e.touches.length === 2) {
                // Масштабирование pinch-жестом
                const touch1 = e.touches[0];
                const touch2 = e.touches[1];
                this.pinchStartDistance = Math.hypot(
                    touch2.clientX - touch1.clientX,
                    touch2.clientY - touch1.clientY
                );
                this.pinchStartScale = this.scale;
            }
        }, {
            passive: false
        });

        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();

            if (e.touches.length === 1 && this.isDragging) {
                // Перемещение карты
                const touch = e.touches[0];
                const deltaX = touch.clientX - this.lastDragX;
                const deltaY = touch.clientY - this.lastDragY;

                this.offsetX += deltaX;
                this.offsetY += deltaY;

                this.lastDragX = touch.clientX;
                this.lastDragY = touch.clientY;

                // Ограничить перемещение границами карты
                const maxOffsetX = this.gridSize * this.cellSize * this.scale - this.canvas.width;
                const maxOffsetY = this.gridSize * this.cellSize * this.scale - this.canvas.height;

                this.offsetX = Math.max(0, Math.min(maxOffsetX, this.offsetX));
                this.offsetY = Math.max(0, Math.min(maxOffsetY, this.offsetY));
            } else if (e.touches.length === 2) {
                // Масштабирование pinch-жестом
                const touch1 = e.touches[0];
                const touch2 = e.touches[1];
                const currentDistance = Math.hypot(
                    touch2.clientX - touch1.clientX,
                    touch2.clientY - touch1.clientY
                );

                const delta = currentDistance / this.pinchStartDistance;
                const newScale = Math.max(0.5, Math.min(3, this.pinchStartScale * delta));

                if (newScale !== this.scale) {
                    const rect = this.canvas.getBoundingClientRect();
                    const centerX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
                    const centerY = (touch1.clientY + touch2.clientY) / 2 - rect.top;

                    const worldX = (centerX - this.offsetX) / this.scale;
                    const worldY = (centerY - this.offsetY) / this.scale;

                    this.offsetX = centerX - worldX * newScale;
                    this.offsetY = centerY - worldY * newScale;
                    this.scale = newScale;
                }
            }
        }, {
            passive: false
        });

        this.canvas.addEventListener('touchend', (e) => {
            this.isDragging = false;
        });

        // Модальные окна
        this.setupModalListeners();
        console.log('Event listeners setup complete');
    }

    setupModalListeners() {
        console.log('Setting up modal listeners...');

        document.querySelectorAll('.modal-close, .btn-cancel').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.modal').forEach(modal => {
                    modal.classList.remove('active');
                });
            });
        });

        // Выбор заклинания
        document.querySelectorAll('.spell-option').forEach(option => {
            option.addEventListener('click', () => {
                this.currentConfigSpellType = option.dataset.spell;
                document.getElementById('spell-select-modal').classList.remove('active');
                document.getElementById('spell-config-modal').classList.add('active');

                const icon = document.getElementById('config-spell-icon');
                const name = document.getElementById('config-spell-name');

                if (this.currentConfigSpellType === 'water') {
                    icon.textContent = '💧';
                    name.textContent = 'Водяной выстрел';
                } else if (this.currentConfigSpellType === 'shield') {
                    icon.textContent = '🛡️';
                    name.textContent = 'Щит';
                }

                this.updateSliderValues();
            });
        });

        // Ползунок настройки - исправлен (скорость слева, сила справа)
        const slider = document.getElementById('spell-slider');
        slider.addEventListener('input', () => {
            this.updateSliderValues();
        });

        // Кнопки настройки
        document.getElementById('save-spell').addEventListener('click', () => {
            this.saveSpell();
        });

        document.getElementById('delete-spell').addEventListener('click', () => {
            this.deleteSpell();
        });

        // Долгое нажатие на слот заклинания для редактирования
        let pressTimer;

        document.addEventListener('mousedown', (e) => {
            const spellSlot = e.target.closest('.spell-slot.filled');
            if (spellSlot) {
                pressTimer = setTimeout(() => {
                    const index = parseInt(spellSlot.dataset.index);
                    this.editSpell(index);
                }, 1000); // 1 секунда
            }
        });

        document.addEventListener('mouseup', () => {
            clearTimeout(pressTimer);
        });

        document.addEventListener('touchstart', (e) => {
            const spellSlot = e.target.closest('.spell-slot.filled');
            if (spellSlot) {
                pressTimer = setTimeout(() => {
                    const index = parseInt(spellSlot.dataset.index);
                    this.editSpell(index);
                }, 1000);
            }
        });

        document.addEventListener('touchend', () => {
            clearTimeout(pressTimer);
        });
    }

    updateSliderValues() {
        const slider = document.getElementById('spell-slider');
        const speed = parseInt(slider.value);
        const power = 11 - speed; // Исправлено: скорость + сила = 11

        document.getElementById('speed-value').textContent = speed;
        document.getElementById('power-value').textContent = power;
        document.getElementById('cast-time').textContent = (speed * 0.25).toFixed(2); // 0.25 секунды за единицу скорости
    }

    editSpell(index) {
        if (!this.gameState || !this.playerId) return;

        const player = this.gameState.players[this.playerId];
        if (!player || !player.spells || !player.spells[index]) return;

        const spell = player.spells[index];
        this.currentConfigSpellIndex = index;
        this.currentConfigSpellType = spell.type;

        // Установить значения ползунка (обратная логика: скорость = 11 - сила)
        const slider = document.getElementById('spell-slider');
        slider.value = spell.speed; // Теперь правильно: слайдер = скорость

        const icon = document.getElementById('config-spell-icon');
        const name = document.getElementById('config-spell-name');

        if (spell.type === 'water') {
            icon.textContent = '💧';
            name.textContent = 'Водяной выстрел';
        } else if (spell.type === 'shield') {
            icon.textContent = '🛡️';
            name.textContent = 'Щит';
        }

        this.updateSliderValues();
        document.getElementById('spell-config-modal').classList.add('active');
    }

    saveSpell() {
        if (this.currentConfigSpellIndex !== null && this.currentConfigSpellType) {
            const speed = parseInt(document.getElementById('spell-slider').value);
            const power = 11 - speed; // Исправлено

            const spell = {
                type: this.currentConfigSpellType,
                speed: speed,
                power: power
            };

            this.socket.emit('updateSpell', {
                index: this.currentConfigSpellIndex,
                spell: spell
            });

            document.getElementById('spell-config-modal').classList.remove('active');
            this.currentConfigSpellIndex = null;
            this.currentConfigSpellType = null;
        }
    }

    deleteSpell() {
        if (this.currentConfigSpellIndex !== null) {
            this.socket.emit('removeSpell', this.currentConfigSpellIndex);
            document.getElementById('spell-config-modal').classList.remove('active');
            this.currentConfigSpellIndex = null;
            this.currentConfigSpellType = null;
        }
    }

    setupSocketListeners() {
        console.log('Setting up socket listeners...');

        this.socket.on('connect', () => {
            console.log('Socket connected');
        });

        this.socket.on('disconnect', () => {
            console.log('Socket disconnected');
        });

        this.socket.on('connect_error', (error) => {
            console.error('Socket connection error:', error);
        });

        this.socket.on('init', (data) => {
            console.log('Received init data:', data);
            this.playerId = data.playerId;
            this.gridSize = data.gridSize;
            this.cellSize = data.cellSize;

            // Установить никнейм и цвет из сервера
            document.getElementById('nickname').textContent = data.nickname;
            this.centerOnPlayer();
        });

        this.socket.on('gameState', (state) => {
            if (!this.gameState) {
                console.log('Received initial game state');
            }
            this.gameState = state;
            this.updateUI();
            this.updateSpellsPanel();
        });
    }

    zoom(factor) {
        const newScale = Math.max(0.5, Math.min(3, this.scale * factor));

        if (newScale !== this.scale) {
            const rect = this.canvas.getBoundingClientRect();
            const centerX = this.canvas.width / 2;
            const centerY = this.canvas.height / 2;

            const worldX = (centerX - this.offsetX) / this.scale;
            const worldY = (centerY - this.offsetY) / this.scale;

            this.offsetX = centerX - worldX * newScale;
            this.offsetY = centerY - worldY * newScale;
            this.scale = newScale;
        }
    }

    centerOnPlayer() {
        if (!this.gameState || !this.playerId || !this.gameState.players[this.playerId]) {
            return;
        }

        const player = this.gameState.players[this.playerId];
        const screenWidth = this.canvas.width;
        const screenHeight = this.canvas.height;

        const worldWidth = this.gridSize * this.cellSize * this.scale;
        const worldHeight = this.gridSize * this.cellSize * this.scale;

        const targetX = player.x * this.cellSize * this.scale - screenWidth / 2;
        const targetY = player.y * this.cellSize * this.scale - screenHeight / 2;

        // Ограничить смещение границами мира
        const maxOffsetX = Math.max(0, worldWidth - screenWidth);
        const maxOffsetY = Math.max(0, worldHeight - screenHeight);

        this.offsetX = Math.max(0, Math.min(maxOffsetX, targetX));
        this.offsetY = Math.max(0, Math.min(maxOffsetY, targetY));
    }

    updateUI() {
        if (!this.gameState || !this.playerId) return;

        const player = this.gameState.players[this.playerId];
        if (!player) return;

        // Обновление верхней панели
        document.getElementById('hp').textContent = `${player.hp}/10`;
        document.getElementById('shield').textContent = player.shield;
        document.getElementById('score').textContent = player.score;

        // Центрирование камеры на игроке
        this.centerOnPlayer();
    }

    updateSpellsPanel() {
        if (!this.gameState || !this.playerId) {
            console.log('Cannot update spells panel: no player');
            return;
        }

        const player = this.gameState.players[this.playerId];
        if (!player || !player.spells) {
            console.log('Cannot update spells panel: no player spells');
            return;
        }

        const spellsPanel = document.getElementById('spells-panel');
        if (!spellsPanel) {
            console.error('Spells panel element not found!');
            return;
        }

        spellsPanel.innerHTML = '';
        console.log('Updating spells panel with', player.spells.length, 'spells');

        // ВАЖНО: порядок снизу вверх - реверсируем массив
        const reversedSpells = [...player.spells].reverse();

        reversedSpells.forEach((spell, reversedIndex) => {
            const originalIndex = player.spells.length - 1 - reversedIndex;
            const slot = document.createElement('div');
            slot.className = `spell-slot ${spell ? 'filled' : 'empty'}`;
            slot.dataset.index = originalIndex;

            if (originalIndex === this.selectedSpellIndex) {
                slot.classList.add('selected');
            }

            if (spell) {
                let icon, color;
                if (spell.type === 'water') {
                    icon = '💧';
                    color = '#4D96FF';
                } else {
                    icon = '🛡️';
                    color = '#FFD700';
                }

                slot.innerHTML = `
                    <div class="spell-icon" style="color: ${color}">${icon}</div>
                    <div class="spell-stats">
                        ⚡${spell.speed} 💪${spell.power}
                    </div>
                `;

                slot.addEventListener('click', (e) => {
                    if (!e.target.closest('.spell-slot')) return;

                    console.log('Selecting spell at index', originalIndex);
                    this.selectedSpellIndex = originalIndex;
                    this.updateSpellsPanel();
                });

                // Долгое нажатие для редактирования
                let pressTimer;
                slot.addEventListener('mousedown', () => {
                    pressTimer = setTimeout(() => {
                        console.log('Long press on spell at index', originalIndex);
                        this.editSpell(originalIndex);
                    }, 1000);
                });

                slot.addEventListener('mouseup', () => {
                    clearTimeout(pressTimer);
                });

                slot.addEventListener('mouseleave', () => {
                    clearTimeout(pressTimer);
                });
            } else {
                slot.textContent = '+';
                slot.addEventListener('click', () => {
                    console.log('Adding new spell at index', originalIndex);
                    this.currentConfigSpellIndex = originalIndex;
                    document.getElementById('spell-select-modal').classList.add('active');
                });
            }

            spellsPanel.appendChild(slot);
        });
    }

    editSpell(index) {
        if (!this.gameState || !this.playerId) return;

        const player = this.gameState.players[this.playerId];
        if (!player || !player.spells || !player.spells[index]) return;

        const spell = player.spells[index];
        this.currentConfigSpellIndex = index;
        this.currentConfigSpellType = spell.type;

        const slider = document.getElementById('spell-slider');
        slider.value = spell.speed;

        const icon = document.getElementById('config-spell-icon');
        const name = document.getElementById('config-spell-name');

        if (spell.type === 'water') {
            icon.textContent = '💧';
            name.textContent = 'Водяной выстрел';
        } else if (spell.type === 'shield') {
            icon.textContent = '🛡️';
            name.textContent = 'Щит';
        }

        this.updateSliderValues();
        document.getElementById('spell-config-modal').classList.add('active');
    }

    castSpell() {
        if (this.selectedSpellIndex !== null) {
            console.log('Casting spell at index', this.selectedSpellIndex);
            this.socket.emit('castSpell', {
                spellIndex: this.selectedSpellIndex
            });
            this.showCastAnimation();
        } else {
            console.log('No spell selected');
        }
    }

    showCastAnimation() {
        if (!this.gameState || !this.playerId) return;

        const player = this.gameState.players[this.playerId];
        if (!player || !player.spells || !player.spells[index]) return;

        const spell = player.spells[player.casting.index];
        const castTime = spell.speed * 250; // 0.25 секунды за единицу скорости
        const indicator = document.getElementById('cast-indicator');

        // Позиционировать индикатор вокруг игрока
        const screenPos = this.worldToScreen(player.x, player.y);
        indicator.style.width = '80px';
        indicator.style.height = '80px';
        indicator.style.left = (screenPos.x - 40) + 'px';
        indicator.style.top = (screenPos.y - 40) + 'px';
        indicator.style.border = '3px solid #4d96ff';
        indicator.style.borderRadius = '50%';
        indicator.className = 'cast-indicator active';

        // Анимация прогресса
        indicator.animate([{
                borderTopColor: '#4d96ff',
                borderRightColor: 'transparent',
                borderBottomColor: 'transparent',
                borderLeftColor: 'transparent'
            },
            {
                borderTopColor: '#4d96ff',
                borderRightColor: '#4d96ff',
                borderBottomColor: 'transparent',
                borderLeftColor: 'transparent'
            },
            {
                borderTopColor: '#4d96ff',
                borderRightColor: '#4d96ff',
                borderBottomColor: '#4d96ff',
                borderLeftColor: 'transparent'
            },
            {
                borderTopColor: '#4d96ff',
                borderRightColor: '#4d96ff',
                borderBottomColor: '#4d96ff',
                borderLeftColor: '#4d96ff'
            }
        ], {
            duration: castTime,
            easing: 'linear'
        });

        // Завершение каста
        setTimeout(() => {
            if (player.spells[player.casting.index]?.type === 'water') {
                this.socket.emit('castComplete');
            }
            indicator.className = 'cast-indicator';
        }, castTime);
    }

    worldToScreen(worldX, worldY) {
        return {
            x: worldX * this.cellSize * this.scale + this.offsetX,
            y: worldY * this.cellSize * this.scale + this.offsetY
        };
    }

    screenToWorld(screenX, screenY) {
        return {
            x: (screenX - this.offsetX) / (this.cellSize * this.scale),
            y: (screenY - this.offsetY) / (this.cellSize * this.scale)
        };
    }

    render() {
        try {
            if (!this.gameState) {
                // Рисуем сообщение о загрузке
                this.ctx.fillStyle = '#162447';
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

                this.ctx.fillStyle = 'white';
                this.ctx.font = '20px Arial';
                this.ctx.textAlign = 'center';
                this.ctx.fillText('Подключение к серверу...', this.canvas.width / 2, this.canvas.height / 2);

                requestAnimationFrame(() => this.render());
                return;
            }

            // Очистка canvas
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

            // Сохраняем трансформацию
            this.ctx.save();

            // Применяем трансформацию камеры
            this.ctx.translate(this.offsetX, this.offsetY);
            this.ctx.scale(this.scale, this.scale);

            // Рендеринг пола
            this.renderFloor();

            // Рендеринг блоков
            this.renderBlocks();

            // Рендеринг заклинаний
            this.renderSpells();

            // Рендеринг игроков
            this.renderPlayers();

            // Восстанавливаем трансформацию
            this.ctx.restore();

            requestAnimationFrame(() => this.render());
        } catch (error) {
            console.error('Render error:', error);
            requestAnimationFrame(() => this.render());
        }
    }

    renderFloor() {
        // Если есть спрайт пола, рисуем его
        if (this.sprites.floor && this.sprites.loaded) {
            for (let x = 0; x < this.gridSize; x++) {
                for (let y = 0; y < this.gridSize; y++) {
                    this.ctx.drawImage(
                        this.sprites.floor,
                        x * this.cellSize,
                        y * this.cellSize,
                        this.cellSize,
                        this.cellSize
                    );
                }
            }
        } else {
            // Fallback: заливаем цветом
            this.ctx.fillStyle = '#162447';
            this.ctx.fillRect(0, 0, this.gridSize * this.cellSize, this.gridSize * this.cellSize);

            // Сетка
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            this.ctx.lineWidth = 1;

            for (let x = 0; x <= this.gridSize; x++) {
                this.ctx.beginPath();
                this.ctx.moveTo(x * this.cellSize, 0);
                this.ctx.lineTo(x * this.cellSize, this.gridSize * this.cellSize);
                this.ctx.stroke();
            }

            for (let y = 0; y <= this.gridSize; y++) {
                this.ctx.beginPath();
                this.ctx.moveTo(0, y * this.cellSize);
                this.ctx.lineTo(this.gridSize * this.cellSize, y * this.cellSize);
                this.ctx.stroke();
            }
        }
    }

    renderBlocks() {
        if (!this.gameState || !this.gameState.blocks) return;

        this.gameState.blocks.forEach(block => {
            const x = block.x * this.cellSize;
            const y = block.y * this.cellSize;

            if (block.indestructible) {
                // Несокрушимые стены
                if (this.sprites.wall && this.sprites.loaded) {
                    this.ctx.drawImage(this.sprites.wall, x, y, this.cellSize, this.cellSize);
                } else {
                    this.ctx.fillStyle = '#393e46';
                    this.ctx.fillRect(x, y, this.cellSize, this.cellSize);

                    this.ctx.strokeStyle = '#222831';
                    this.ctx.lineWidth = 2;
                    this.ctx.strokeRect(x + 2, y + 2, this.cellSize - 4, this.cellSize - 4);
                }
            } else if (block.hp > 0) {
                // Разрушаемые блоки
                const opacity = 0.3 + (block.hp / 5) * 0.7;

                if (this.sprites.block && this.sprites.loaded) {
                    this.ctx.globalAlpha = opacity;
                    this.ctx.drawImage(this.sprites.block, x, y, this.cellSize, this.cellSize);
                    this.ctx.globalAlpha = 1.0;
                } else {
                    this.ctx.fillStyle = `rgba(139, 69, 19, ${opacity})`;
                    this.ctx.fillRect(x + 2, y + 2, this.cellSize - 4, this.cellSize - 4);

                    // Текстура блока
                    this.ctx.strokeStyle = `rgba(101, 67, 33, ${opacity})`;
                    this.ctx.lineWidth = 1;

                    for (let i = 0; i < 3; i++) {
                        for (let j = 0; j < 3; j++) {
                            const bx = x + 4 + i * 12;
                            const by = y + 4 + j * 12;
                            this.ctx.strokeRect(bx, by, 8, 8);
                        }
                    }
                }

                // Отображение прочности блока (для отладки)
                this.ctx.fillStyle = 'white';
                this.ctx.font = 'bold 12px Arial';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText(block.hp, x + this.cellSize / 2, y + this.cellSize / 2);
            }
        });
    }

    renderSpells() {
        if (!this.gameState || !this.gameState.spells) return;

        this.gameState.spells.forEach(spell => {
            const x = spell.x * this.cellSize;
            const y = spell.y * this.cellSize;

            this.ctx.save();
            this.ctx.translate(x, y);

            if (spell.type === 'water') {
                if (this.sprites.waterSpell && this.sprites.loaded) {
                    this.ctx.drawImage(this.sprites.waterSpell, -15, -15, 30, 30);
                } else {
                    // Водяной выстрел
                    const gradient = this.ctx.createRadialGradient(0, 0, 5, 0, 0, 15);
                    gradient.addColorStop(0, 'rgba(77, 150, 255, 0.8)');
                    gradient.addColorStop(1, 'rgba(77, 150, 255, 0.2)');

                    this.ctx.fillStyle = gradient;
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, 15, 0, Math.PI * 2);
                    this.ctx.fill();

                    // Направление
                    this.ctx.rotate(spell.direction);
                    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                    this.ctx.fillRect(0, -3, 20, 6);
                }
            }

            this.ctx.restore();
        });
    }

    renderPlayers() {
        if (!this.gameState || !this.gameState.players) return;

        for (const player of Object.values(this.gameState.players)) {
            if (player.hp <= 0) continue; // Теперь это работает в for...of

            const x = player.x * this.cellSize;
            const y = player.y * this.cellSize;

            this.ctx.save();
            this.ctx.translate(x, y);

            // Тело игрока
            if (this.sprites.player && this.sprites.loaded) {
                this.ctx.drawImage(this.sprites.player, -15, -15, 30, 30);
            } else {
                this.ctx.fillStyle = player.color || (player.id === this.playerId ? '#4ecca3' : '#ff6b6b');
                this.ctx.beginPath();
                this.ctx.arc(0, 0, 15, 0, Math.PI * 2);
                this.ctx.fill();

                // Контур
                this.ctx.strokeStyle = '#000';
                this.ctx.lineWidth = 2;
                this.ctx.stroke();
            }

            // Щит
            if (player.shield > 0) {
                if (this.sprites.shieldSpell && this.sprites.loaded) {
                    this.ctx.globalAlpha = 0.6;
                    this.ctx.drawImage(this.sprites.shieldSpell, -20, -20, 40, 40);
                    this.ctx.globalAlpha = 1.0;
                } else {
                    this.ctx.strokeStyle = 'rgba(255, 215, 0, 0.6)';
                    this.ctx.lineWidth = 3;
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, 20, 0, Math.PI * 2);
                    this.ctx.stroke();
                }
            }

            // Направление взгляда
            this.ctx.rotate(player.direction);
            this.ctx.fillStyle = 'white';
            this.ctx.fillRect(10, -2, 10, 4);

            this.ctx.restore();

            // Никнейм и здоровье
            this.ctx.save();
            this.ctx.translate(x, y - 30);
            this.ctx.fillStyle = 'white';
            this.ctx.font = '12px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(player.nickname, 0, 0);

            // Здоровье
            this.ctx.font = '10px Arial';
            this.ctx.fillStyle = '#ff6b6b';
            this.ctx.fillText(`❤${player.hp}`, 0, 15);

            this.ctx.restore();
        };
    }
}

// Запуск игры при загрузке страницы
window.addEventListener('load', () => {
    console.log('Window loaded, starting game...');
    try {
        new MagicBomberman();
        console.log('Game started successfully');
    } catch (error) {
        console.error('Failed to start game:', error);
        alert('Ошибка запуска игры. Проверьте консоль для деталей.');
    }
});