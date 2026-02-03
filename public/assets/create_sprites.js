// create_sprites.js (в корне проекта)
const fs = require('fs');
const path = require('path');
const {
    createCanvas
} = require('canvas');

// Путь к папке assets
const assetsPath = path.join(__dirname, 'public', 'assets');

// Создаем папку, если её нет
if (!fs.existsSync(assetsPath)) {
    fs.mkdirSync(assetsPath, {
        recursive: true
    });
    console.log(`Создана папка: ${assetsPath}`);
}

function createSprite(name, color, text = '') {
    const canvas = createCanvas(32, 32);
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

    // Сохраняем файл
    const filePath = path.join(assetsPath, `${name}.png`);
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(filePath, buffer);
    console.log(`Создан спрайт: ${filePath}`);
}

// Создаем спрайты
createSprite('floor', '#162447');
createSprite('wall', '#393e46', 'W');
createSprite('block', '#8B4513', 'B');
createSprite('block_cracked', '#A0522D', 'C');
createSprite('player', '#4ECCA3', 'P');
createSprite('water_spell', '#4D96FF', 'W');
createSprite('shield_spell', '#FFD700', 'S');

console.log('Все спрайты созданы!');