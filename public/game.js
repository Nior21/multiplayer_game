class MagicBomberman {
    constructor() {
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

        this.selectedSpellIndex = 0;
        this.currentConfigSpellIndex = null;
        this.currentConfigSpellType = null;

        this.keys = {};
        this.touchPositions = {};
        this.pinchStartDistance = 0;
        this.pinchStartScale = 1;

        this.init();
    }

    init() {
        this.setupCanvas();
        this.setupEventListeners();
        this.setupSocketListeners();
        this.render();
    }

    setupCanvas() {
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.centerOnPlayer();
    }

    setupEventListeners() {
        // Блокировка стандартного масштабирования браузера
        document.addEventListener('wheel', (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
            }
        }, {
            passive: false
        });

        document.addEventListener('keydown', (e) => {
            e.preventDefault();
            if (!this.keys[e.key]) {
                this.keys[e.key] = true;

                // Управление WASD
                if (e.key === 'w' || e.key === 'W' || e.key === 'ц' || e.key === 'Ц') {
                    this.socket.emit('move', 'up');
                } else if (e.key === 'a' || e.key === 'A' || e.key === 'ф' || e.key === 'Ф') {
                    this.socket.emit('move', 'left');
                } else if (e.key === 's' || e.key === 'S' || e.key === 'ы' || e.key === 'Ы') {
                    this.socket.emit('move', 'down');
                } else if (e.key === 'd' || e.key === 'D' || e.key === 'в' || e.key === 'В') {
                    this.socket.emit('move', 'right');
                }

                // Каст заклинания пробелом
                if (e.key === ' ' && this.selectedSpellIndex !== null) {
                    this.castSpell();
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

        // Тач-жесты для масштабирования
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();

            for (let i = 0; i < e.touches.length; i++) {
                const touch = e.touches[i];
                this.touchPositions[touch.identifier] = {
                    x: touch.clientX,
                    y: touch.clientY
                };
            }

            if (e.touches.length === 2) {
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

            if (e.touches.length === 2) {
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
            } else if (e.touches.length === 1) {
                // Перемещение карты одним пальцем
                const touch = e.touches[0];
                const prevPos = this.touchPositions[touch.identifier];

                if (prevPos) {
                    this.offsetX += touch.clientX - prevPos.x;
                    this.offsetY += touch.clientY - prevPos.y;

                    this.touchPositions[touch.identifier] = {
                        x: touch.clientX,
                        y: touch.clientY
                    };
                }
            }
        }, {
            passive: false
        });

        this.canvas.addEventListener('touchend', (e) => {
            for (let i = 0; i < e.changedTouches.length; i++) {
                const touch = e.changedTouches[i];
                delete this.touchPositions[touch.identifier];
            }
        });

        // Выбор заклинания
        this.updateSpellsPanel();

        // Модальные окна
        this.setupModalListeners();
    }

    setupModalListeners() {
        // Закрытие модальных окон
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

        // Ползунок настройки
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
    }

    updateSliderValues() {
        const slider = document.getElementById('spell-slider');
        const speed = parseInt(slider.value);
        const power = 11 - speed;

        document.getElementById('speed-value').textContent = speed;
        document.getElementById('power-value').textContent = power;
        document.getElementById('cast-time').textContent = (speed * 0.1).toFixed(1);
    }

    saveSpell() {
        if (this.currentConfigSpellIndex !== null && this.currentConfigSpellType) {
            const speed = parseInt(document.getElementById('spell-slider').value);
            const power = 11 - speed;

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
        this.socket.on('init', (data) => {
            this.playerId = data.playerId;
            this.gridSize = data.gridSize;
            this.cellSize = data.cellSize;
            this.centerOnPlayer();
        });

        this.socket.on('gameState', (state) => {
            this.gameState = state;
            this.updateUI();
            this.updateSpellsPanel();
        });
    }

    centerOnPlayer() {
        if (!this.gameState || !this.playerId || !this.gameState.players[this.playerId]) {
            return;
        }

        const player = this.gameState.players[this.playerId];
        const screenWidth = this.canvas.width;
        const screenHeight = this.canvas.height;

        const maxOffsetX = this.gridSize * this.cellSize * this.scale - screenWidth;
        const maxOffsetY = this.gridSize * this.cellSize * this.scale - screenHeight;

        const targetX = player.x * this.cellSize * this.scale - screenWidth / 2;
        const targetY = player.y * this.cellSize * this.scale - screenHeight / 2;

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
        if (!this.gameState || !this.playerId) return;

        const player = this.gameState.players[this.playerId];
        if (!player) return;

        const spellsPanel = document.getElementById('spells-panel');
        spellsPanel.innerHTML = '';

        player.spells.forEach((spell, index) => {
            const slot = document.createElement('div');
            slot.className = `spell-slot ${spell ? 'filled' : 'empty'}`;

            if (index === this.selectedSpellIndex) {
                slot.classList.add('selected');
            }

            if (spell) {
                slot.innerHTML = `
                    <div class="spell-icon ${spell.type}-icon">
                        ${spell.type === 'water' ? '💧' : '🛡️'}
                    </div>
                    <div class="spell-stats">
                        ⚡${spell.speed} 💪${spell.power}
                    </div>
                `;

                slot.addEventListener('click', () => {
                    this.selectedSpellIndex = index;
                    this.updateSpellsPanel();
                });
            } else {
                slot.textContent = '+';
                slot.addEventListener('click', () => {
                    this.currentConfigSpellIndex = index;
                    document.getElementById('spell-select-modal').classList.add('active');
                });
            }

            spellsPanel.appendChild(slot);
        });
    }

    castSpell() {
        if (this.selectedSpellIndex !== null) {
            this.socket.emit('castSpell', {
                spellIndex: this.selectedSpellIndex
            });

            // Запустить анимацию каста
            this.showCastAnimation();
        }
    }

    showCastAnimation() {
        if (!this.gameState || !this.playerId) return;

        const player = this.gameState.players[this.playerId];
        if (!player || !player.casting) return;

        const castTime = player.casting.duration;
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

    render() {
        if (!this.gameState) {
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

        // Рендеринг карты
        this.renderMap();

        // Рендеринг блоков
        this.renderBlocks();

        // Рендеринг заклинаний
        this.renderSpells();

        // Рендеринг игроков
        this.renderPlayers();

        // Восстанавливаем трансформацию
        this.ctx.restore();

        requestAnimationFrame(() => this.render());
    }

    renderMap() {
        // Фон
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

    renderBlocks() {
        if (!this.gameState.blocks) return;

        this.gameState.blocks.forEach(block => {
            const x = block.x * this.cellSize;
            const y = block.y * this.cellSize;

            if (block.indestructible) {
                // Несокрушимые стены
                this.ctx.fillStyle = '#393e46';
                this.ctx.fillRect(x, y, this.cellSize, this.cellSize);

                this.ctx.strokeStyle = '#222831';
                this.ctx.lineWidth = 2;
                this.ctx.strokeRect(x + 2, y + 2, this.cellSize - 4, this.cellSize - 4);
            } else if (block.hp > 0) {
                // Разрушаемые блоки
                const opacity = 0.3 + (block.hp / 5) * 0.7;
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
        });
    }

    renderSpells() {
        if (!this.gameState.spells) return;

        this.gameState.spells.forEach(spell => {
            const x = spell.x * this.cellSize;
            const y = spell.y * this.cellSize;

            this.ctx.save();
            this.ctx.translate(x, y);

            if (spell.type === 'water') {
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

            this.ctx.restore();
        });
    }

    renderPlayers() {
        if (!this.gameState.players) return;

        const players = Object.values(this.gameState.players);

        for (let i = 0; i < players.length; i++) {
            const player = players[i];

            if (player.hp <= 0) continue;

            const x = player.x * this.cellSize;
            const y = player.y * this.cellSize;

            this.ctx.save();
            this.ctx.translate(x, y);

            // Тело игрока
            this.ctx.fillStyle = player.id === this.playerId ? '#4ecca3' : '#ff6b6b';
            this.ctx.beginPath();
            this.ctx.arc(0, 0, 15, 0, Math.PI * 2);
            this.ctx.fill();

            // Щит
            if (player.shield > 0) {
                this.ctx.strokeStyle = 'rgba(255, 215, 0, 0.6)';
                this.ctx.lineWidth = 3;
                this.ctx.beginPath();
                this.ctx.arc(0, 0, 20, 0, Math.PI * 2);
                this.ctx.stroke();
            }

            // Направление взгляда
            this.ctx.rotate(player.direction);
            this.ctx.fillStyle = 'white';
            this.ctx.fillRect(10, -2, 10, 4);

            // Никнейм
            this.ctx.restore();
            this.ctx.save();
            this.ctx.translate(x, y - 30);
            this.ctx.fillStyle = 'white';
            this.ctx.font = '12px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(player.nickname, 0, 0);

            // Здоровье
            this.ctx.font = '10px Arial';
            this.ctx.fillStyle = '#ff6b6b';
            this.ctx.fillText(`❤${player.hp}`, 0, 15);

            this.ctx.restore();
        }
    }
}

// Запуск игры при загрузке страницы
window.addEventListener('load', () => {
    new MagicBomberman();
});

// Блокировка контекстного меню
document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
});