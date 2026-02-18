// ========================================
// Ameisensimulator - Hauptspielcode
// ========================================

(function () {
    'use strict';

    // --- Konfiguration ---
    const CONFIG = {
        // Weltgroesse in Pixeln
        WORLD_WIDTH: 3000,
        WORLD_HEIGHT: 3000,

        // Ameisenkoenigin
        QUEEN_SPEED: 3,
        QUEEN_SIZE: 64, // Anzeige-Groesse der Koenigin in Pixeln

        // Gras-Kachel
        TILE_SIZE: 128, // Groesse einer Gras-Kachel

        // Steuerung
        TAP_THRESHOLD: 15, // Max Pixel-Bewegung fuer einen Tap (vs. Drag)
        MOVE_DEAD_ZONE: 10, // Mindest-Distanz bevor die Ameise sich bewegt
    };

    // --- Canvas Setup ---
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');

    function resizeCanvas() {
        canvas.width = window.innerWidth * window.devicePixelRatio;
        canvas.height = window.innerHeight * window.devicePixelRatio;
        ctx.imageSmoothingEnabled = false; // Pixel-Art scharf halten
    }

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // --- Spielzustand ---
    const state = {
        camera: { x: 0, y: 0 },
        queen: {
            x: CONFIG.WORLD_WIDTH / 2,
            y: CONFIG.WORLD_HEIGHT / 2,
            targetX: null,
            targetY: null,
            angle: 0, // Blickrichtung in Radiant
            moving: false,
        },
        touch: {
            active: false,
            startX: 0,
            startY: 0,
            currentX: 0,
            currentY: 0,
            isDragging: false,
            cameraStartX: 0,
            cameraStartY: 0,
            identifier: null,
        },
        images: {},
        loaded: false,
    };

    // --- Bilder laden ---
    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Bild konnte nicht geladen werden: ' + src));
            img.src = src;
        });
    }

    async function loadAssets() {
        try {
            const [grass, queen] = await Promise.all([
                loadImage('assets/images/grass.png'),
                loadImage('assets/images/queen.png'),
            ]);
            state.images.grass = grass;
            state.images.queen = queen;
            state.loaded = true;
            document.getElementById('loading').style.display = 'none';
        } catch (e) {
            document.getElementById('loading').innerHTML =
                '<div style="text-align:center;padding:20px;">' +
                '<p style="color:#ff6b6b;margin-bottom:12px;">Fehler beim Laden der Grafiken!</p>' +
                '<p style="font-size:14px;">Bitte stelle sicher, dass folgende Dateien vorhanden sind:</p>' +
                '<p style="font-size:14px;margin-top:8px;color:#ffcc00;">assets/images/grass.png</p>' +
                '<p style="font-size:14px;color:#ffcc00;">assets/images/queen.png</p>' +
                '</div>';
            console.error(e);
        }
    }

    // --- Kamera ---
    function updateCamera() {
        const screenW = canvas.width;
        const screenH = canvas.height;

        // Kamera zentriert auf Koenigin, wenn kein Drag aktiv
        if (!state.touch.isDragging) {
            state.camera.x = state.queen.x - screenW / 2;
            state.camera.y = state.queen.y - screenH / 2;
        }

        // Kamera-Grenzen
        state.camera.x = Math.max(0, Math.min(state.camera.x, CONFIG.WORLD_WIDTH - screenW));
        state.camera.y = Math.max(0, Math.min(state.camera.y, CONFIG.WORLD_HEIGHT - screenH));
    }

    // --- Touch-Steuerung ---
    function getScaledTouch(touch) {
        return {
            x: touch.clientX * window.devicePixelRatio,
            y: touch.clientY * window.devicePixelRatio,
        };
    }

    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (state.touch.active) return;

        const touch = e.changedTouches[0];
        const scaled = getScaledTouch(touch);

        state.touch.active = true;
        state.touch.identifier = touch.identifier;
        state.touch.startX = scaled.x;
        state.touch.startY = scaled.y;
        state.touch.currentX = scaled.x;
        state.touch.currentY = scaled.y;
        state.touch.isDragging = false;
        state.touch.cameraStartX = state.camera.x;
        state.touch.cameraStartY = state.camera.y;
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (!state.touch.active) return;

        const touch = Array.from(e.changedTouches).find(
            (t) => t.identifier === state.touch.identifier
        );
        if (!touch) return;

        const scaled = getScaledTouch(touch);
        state.touch.currentX = scaled.x;
        state.touch.currentY = scaled.y;

        const dx = scaled.x - state.touch.startX;
        const dy = scaled.y - state.touch.startY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > CONFIG.TAP_THRESHOLD) {
            state.touch.isDragging = true;
            // Kamera verschieben (entgegengesetzte Richtung zum Finger)
            state.camera.x = state.touch.cameraStartX - dx;
            state.camera.y = state.touch.cameraStartY - dy;
        }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        const touch = Array.from(e.changedTouches).find(
            (t) => t.identifier === state.touch.identifier
        );
        if (!touch) return;

        const scaled = getScaledTouch(touch);

        // Wenn es kein Drag war -> Tap = Bewegungsziel setzen
        if (!state.touch.isDragging) {
            const worldX = scaled.x + state.camera.x;
            const worldY = scaled.y + state.camera.y;

            state.queen.targetX = Math.max(0, Math.min(worldX, CONFIG.WORLD_WIDTH));
            state.queen.targetY = Math.max(0, Math.min(worldY, CONFIG.WORLD_HEIGHT));
            state.queen.moving = true;
        }

        state.touch.active = false;
        state.touch.isDragging = false;
        state.touch.identifier = null;
    }, { passive: false });

    // Auch Touchcancel behandeln
    canvas.addEventListener('touchcancel', (e) => {
        state.touch.active = false;
        state.touch.isDragging = false;
        state.touch.identifier = null;
    });

    // --- Maus-Steuerung (fuer Desktop-Tests) ---
    let mouseDown = false;
    let mouseStartX = 0, mouseStartY = 0;
    let mouseDragging = false;
    let mouseCamStartX = 0, mouseCamStartY = 0;

    canvas.addEventListener('mousedown', (e) => {
        mouseDown = true;
        mouseStartX = e.clientX * window.devicePixelRatio;
        mouseStartY = e.clientY * window.devicePixelRatio;
        mouseDragging = false;
        mouseCamStartX = state.camera.x;
        mouseCamStartY = state.camera.y;
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!mouseDown) return;
        const mx = e.clientX * window.devicePixelRatio;
        const my = e.clientY * window.devicePixelRatio;
        const dx = mx - mouseStartX;
        const dy = my - mouseStartY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > CONFIG.TAP_THRESHOLD) {
            mouseDragging = true;
            state.camera.x = mouseCamStartX - dx;
            state.camera.y = mouseCamStartY - dy;
        }
    });

    canvas.addEventListener('mouseup', (e) => {
        if (!mouseDragging) {
            const mx = e.clientX * window.devicePixelRatio;
            const my = e.clientY * window.devicePixelRatio;
            const worldX = mx + state.camera.x;
            const worldY = my + state.camera.y;

            state.queen.targetX = Math.max(0, Math.min(worldX, CONFIG.WORLD_WIDTH));
            state.queen.targetY = Math.max(0, Math.min(worldY, CONFIG.WORLD_HEIGHT));
            state.queen.moving = true;
        }
        mouseDown = false;
        mouseDragging = false;
    });

    // --- Spiellogik ---
    function updateQueen() {
        const q = state.queen;
        if (!q.moving || q.targetX === null || q.targetY === null) return;

        const dx = q.targetX - q.x;
        const dy = q.targetY - q.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < CONFIG.MOVE_DEAD_ZONE) {
            q.moving = false;
            q.targetX = null;
            q.targetY = null;
            return;
        }

        // Blickrichtung aktualisieren
        q.angle = Math.atan2(dy, dx);

        // Bewegen
        const speed = CONFIG.QUEEN_SPEED;
        q.x += (dx / dist) * speed;
        q.y += (dy / dist) * speed;

        // Weltgrenzen
        q.x = Math.max(CONFIG.QUEEN_SIZE / 2, Math.min(q.x, CONFIG.WORLD_WIDTH - CONFIG.QUEEN_SIZE / 2));
        q.y = Math.max(CONFIG.QUEEN_SIZE / 2, Math.min(q.y, CONFIG.WORLD_HEIGHT - CONFIG.QUEEN_SIZE / 2));
    }

    // --- Rendering ---
    function drawGrass() {
        const img = state.images.grass;
        if (!img) return;

        const tileW = CONFIG.TILE_SIZE;
        const tileH = CONFIG.TILE_SIZE;

        // Nur sichtbare Kacheln zeichnen
        const startCol = Math.floor(state.camera.x / tileW);
        const startRow = Math.floor(state.camera.y / tileH);
        const endCol = Math.ceil((state.camera.x + canvas.width) / tileW);
        const endRow = Math.ceil((state.camera.y + canvas.height) / tileH);

        for (let row = startRow; row <= endRow; row++) {
            for (let col = startCol; col <= endCol; col++) {
                const screenX = col * tileW - state.camera.x;
                const screenY = row * tileH - state.camera.y;
                ctx.drawImage(img, screenX, screenY, tileW, tileH);
            }
        }
    }

    function drawQueen() {
        const img = state.images.queen;
        if (!img) return;

        const q = state.queen;
        const size = CONFIG.QUEEN_SIZE;

        // Position auf dem Bildschirm
        const screenX = q.x - state.camera.x;
        const screenY = q.y - state.camera.y;

        ctx.save();
        ctx.translate(screenX, screenY);
        // Rotation: Bild zeigt nach oben (-PI/2), daher Offset
        ctx.rotate(q.angle + Math.PI / 2);
        ctx.drawImage(img, -size / 2, -size / 2, size, size);
        ctx.restore();
    }

    function drawTargetMarker() {
        const q = state.queen;
        if (!q.moving || q.targetX === null) return;

        const screenX = q.targetX - state.camera.x;
        const screenY = q.targetY - state.camera.y;

        // Pulsierender Kreis als Zielmarkierung
        const pulse = Math.sin(Date.now() / 200) * 0.3 + 0.7;
        ctx.save();
        ctx.globalAlpha = pulse * 0.5;
        ctx.strokeStyle = '#ffcc00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(screenX, screenY, 12 + pulse * 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    function drawMinimap() {
        const mapW = 120;
        const mapH = 120;
        const padding = 10;
        const x = canvas.width - mapW - padding;
        const y = padding;

        // Hintergrund
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = '#1a3a0a';
        ctx.fillRect(x, y, mapW, mapH);
        ctx.strokeStyle = '#4a7a2a';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, mapW, mapH);
        ctx.globalAlpha = 1;

        // Sichtbarer Bereich
        const viewX = x + (state.camera.x / CONFIG.WORLD_WIDTH) * mapW;
        const viewY = y + (state.camera.y / CONFIG.WORLD_HEIGHT) * mapH;
        const viewW = (canvas.width / CONFIG.WORLD_WIDTH) * mapW;
        const viewH = (canvas.height / CONFIG.WORLD_HEIGHT) * mapH;

        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(viewX, viewY, viewW, viewH);

        // Koenigin auf Minimap
        ctx.globalAlpha = 1;
        const queenMapX = x + (state.queen.x / CONFIG.WORLD_WIDTH) * mapW;
        const queenMapY = y + (state.queen.y / CONFIG.WORLD_HEIGHT) * mapH;
        ctx.fillStyle = '#ffcc00';
        ctx.beginPath();
        ctx.arc(queenMapX, queenMapY, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    // --- Hauptschleife ---
    function gameLoop() {
        if (!state.loaded) {
            requestAnimationFrame(gameLoop);
            return;
        }

        // Logik
        updateQueen();
        updateCamera();

        // Rendern
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawGrass();
        drawTargetMarker();
        drawQueen();
        drawMinimap();

        requestAnimationFrame(gameLoop);
    }

    // --- Start ---
    loadAssets();
    gameLoop();

    // --- Service Worker registrieren ---
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js').catch((err) => {
                console.warn('Service Worker konnte nicht registriert werden:', err);
            });
        });
    }
})();
