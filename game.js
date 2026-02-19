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
        QUEEN_SIZE: 96, // Anzeige-Groesse der Koenigin in Pixeln

        // Gras-Kachel
        TILE_SIZE: 128, // Groesse einer Gras-Kachel

        // Steuerung
        TAP_THRESHOLD: 15, // Max Pixel-Bewegung fuer einen Tap (vs. Drag)
        MOVE_DEAD_ZONE: 10, // Mindest-Distanz bevor die Ameise sich bewegt
        DOUBLE_TAP_DELAY: 350, // Max Millisekunden zwischen zwei Taps fuer Doppelklick
        DOUBLE_TAP_RADIUS: 50, // Max Pixel-Abstand zwischen zwei Taps

        // Graben
        HOLE_SIZE: 96, // Anzeige-Groesse eines Lochs in Pixeln
        DIG_DURATION: 60, // Frames die das Graben dauert (ca. 1 Sekunde bei 60fps)

        // Zoom-Stufe (1 = kein Zoom, 2 = doppelt so nah)
        ZOOM: 2,
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
            digging: false, // Graebt gerade ein Loch
            digTimer: 0, // Verbleibende Frames fuer Graben
            digX: null, // Zielposition zum Graben
            digY: null,
            goingToHole: false, // Laeuft zu einem fertigen Loch um hineinzugehen
        },
        holes: [], // Array von {x, y} - gegrabene Loecher
        underground: { active: false }, // Untergrund-Ansicht aktiv
        doubleTap: {
            lastTime: 0, // Zeitpunkt des letzten Taps
            lastX: 0, // Welt-X des letzten Taps
            lastY: 0, // Welt-Y des letzten Taps
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
            const [grass, queen, hole, underground] = await Promise.all([
                loadImage('assets/images/grass.png'),
                loadImage('assets/images/queen.png'),
                loadImage('assets/images/hole.png'),
                loadImage('assets/images/underground.png'),
            ]);
            state.images.grass = grass;
            state.images.queen = queen;
            state.images.hole = hole;
            state.images.underground = underground;
            state.loaded = true;
            document.getElementById('loading').style.display = 'none';
        } catch (e) {
            document.getElementById('loading').innerHTML =
                '<div style="text-align:center;padding:20px;">' +
                '<p style="color:#ff6b6b;margin-bottom:12px;">Fehler beim Laden der Grafiken!</p>' +
                '<p style="font-size:14px;">Bitte stelle sicher, dass folgende Dateien vorhanden sind:</p>' +
                '<p style="font-size:14px;margin-top:8px;color:#ffcc00;">assets/images/grass.png</p>' +
                '<p style="font-size:14px;color:#ffcc00;">assets/images/queen.png</p>' +
                '<p style="font-size:14px;color:#ffcc00;">assets/images/hole.png</p>' +
                '</div>';
            console.error(e);
        }
    }

    // --- Kamera ---
    function updateCamera() {
        // Sichtbarer Bereich in Welt-Koordinaten (kleiner bei hoeherem Zoom)
        const viewW = canvas.width / CONFIG.ZOOM;
        const viewH = canvas.height / CONFIG.ZOOM;

        // Kamera zentriert auf Koenigin, wenn kein Drag aktiv
        if (!state.touch.isDragging) {
            state.camera.x = state.queen.x - viewW / 2;
            state.camera.y = state.queen.y - viewH / 2;
        }

        // Kamera-Grenzen
        state.camera.x = Math.max(0, Math.min(state.camera.x, CONFIG.WORLD_WIDTH - viewW));
        state.camera.y = Math.max(0, Math.min(state.camera.y, CONFIG.WORLD_HEIGHT - viewH));
    }

    // --- Tap-Verarbeitung (Einzelklick vs. Doppelklick) ---
    function handleTap(worldX, worldY) {
        // Untergrund-Ansicht: Tippen beendet sie
        if (state.underground.active) {
            state.underground.active = false;
            return;
        }

        // Pruefen ob auf ein fertiges Loch geklickt wurde
        const holeRadius = CONFIG.HOLE_SIZE / 2;
        for (let i = 0; i < state.holes.length; i++) {
            const h = state.holes[i];
            const dx = worldX - h.x;
            const dy = worldY - h.y;
            if (Math.sqrt(dx * dx + dy * dy) <= holeRadius) {
                // Klick auf Loch -> Ameise zum Loch schicken
                state.queen.targetX = h.x;
                state.queen.targetY = h.y;
                state.queen.moving = true;
                state.queen.digging = false;
                state.queen.digX = null;
                state.queen.digY = null;
                state.queen.goingToHole = true;
                state.doubleTap.lastTime = 0; // Kein Doppel-Tap-Graben auf Loecher
                return;
            }
        }

        const now = Date.now();
        const dt = now - state.doubleTap.lastTime;
        const dx = worldX - state.doubleTap.lastX;
        const dy = worldY - state.doubleTap.lastY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dt < CONFIG.DOUBLE_TAP_DELAY && dist < CONFIG.DOUBLE_TAP_RADIUS) {
            // Doppelklick erkannt -> Graben starten
            state.doubleTap.lastTime = 0; // Reset damit kein Triple-Tap ausloest
            startDigging(worldX, worldY);
        } else {
            // Einfacher Tap -> Ameise bewegen
            state.doubleTap.lastTime = now;
            state.doubleTap.lastX = worldX;
            state.doubleTap.lastY = worldY;

            state.queen.targetX = Math.max(0, Math.min(worldX, CONFIG.WORLD_WIDTH));
            state.queen.targetY = Math.max(0, Math.min(worldY, CONFIG.WORLD_HEIGHT));
            state.queen.moving = true;
            state.queen.digging = false;
            state.queen.digX = null;
            state.queen.digY = null;
            state.queen.goingToHole = false;
        }
    }

    function startDigging(worldX, worldY) {
        const q = state.queen;
        const clampedX = Math.max(0, Math.min(worldX, CONFIG.WORLD_WIDTH));
        const clampedY = Math.max(0, Math.min(worldY, CONFIG.WORLD_HEIGHT));

        q.digX = clampedX;
        q.digY = clampedY;
        q.targetX = clampedX;
        q.targetY = clampedY;
        q.moving = true;
        q.digging = true;
        q.digTimer = CONFIG.DIG_DURATION;
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
            // Kamera verschieben (entgegengesetzte Richtung zum Finger, Zoom beruecksichtigen)
            state.camera.x = state.touch.cameraStartX - dx / CONFIG.ZOOM;
            state.camera.y = state.touch.cameraStartY - dy / CONFIG.ZOOM;
        }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        const touch = Array.from(e.changedTouches).find(
            (t) => t.identifier === state.touch.identifier
        );
        if (!touch) return;

        const scaled = getScaledTouch(touch);

        // Wenn es kein Drag war -> Tap verarbeiten (Einzel- oder Doppeltap)
        if (!state.touch.isDragging) {
            const worldX = scaled.x / CONFIG.ZOOM + state.camera.x;
            const worldY = scaled.y / CONFIG.ZOOM + state.camera.y;
            handleTap(worldX, worldY);
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
            state.camera.x = mouseCamStartX - dx / CONFIG.ZOOM;
            state.camera.y = mouseCamStartY - dy / CONFIG.ZOOM;
        }
    });

    canvas.addEventListener('mouseup', (e) => {
        if (!mouseDragging) {
            const mx = e.clientX * window.devicePixelRatio;
            const my = e.clientY * window.devicePixelRatio;
            const worldX = mx / CONFIG.ZOOM + state.camera.x;
            const worldY = my / CONFIG.ZOOM + state.camera.y;
            handleTap(worldX, worldY);
        }
        mouseDown = false;
        mouseDragging = false;
    });

    // --- Spiellogik ---
    function updateQueen() {
        const q = state.queen;

        // Grab-Timer laeuft: Ameise steht still und graebt
        if (q.digging && q.digTimer > 0 && !q.moving) {
            q.digTimer--;
            if (q.digTimer <= 0) {
                // Graben fertig -> Loch platzieren
                state.holes.push({ x: q.digX, y: q.digY });
                q.digging = false;
                q.digX = null;
                q.digY = null;
            }
            return;
        }

        if (!q.moving || q.targetX === null || q.targetY === null) return;

        const dx = q.targetX - q.x;
        const dy = q.targetY - q.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < CONFIG.MOVE_DEAD_ZONE) {
            q.moving = false;
            q.targetX = null;
            q.targetY = null;
            // Wenn Grab-Auftrag aktiv, Timer starten
            if (q.digging) {
                q.digTimer = CONFIG.DIG_DURATION;
            }
            // Wenn Ameise am Loch angekommen -> Untergrund-Ansicht aktivieren
            if (q.goingToHole) {
                q.goingToHole = false;
                state.underground.active = true;
            }
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

        // Nur sichtbare Kacheln zeichnen (Sichtbereich durch Zoom begrenzt)
        const startCol = Math.floor(state.camera.x / tileW);
        const startRow = Math.floor(state.camera.y / tileH);
        const endCol = Math.ceil((state.camera.x + canvas.width / CONFIG.ZOOM) / tileW);
        const endRow = Math.ceil((state.camera.y + canvas.height / CONFIG.ZOOM) / tileH);

        for (let row = startRow; row <= endRow; row++) {
            for (let col = startCol; col <= endCol; col++) {
                const screenX = col * tileW - state.camera.x;
                const screenY = row * tileH - state.camera.y;
                ctx.drawImage(img, screenX, screenY, tileW, tileH);
            }
        }
    }

    function drawHoles() {
        const img = state.images.hole;
        if (!img) return;

        const size = CONFIG.HOLE_SIZE;
        for (let i = 0; i < state.holes.length; i++) {
            const h = state.holes[i];
            const screenX = h.x - state.camera.x;
            const screenY = h.y - state.camera.y;
            ctx.drawImage(img, screenX - size / 2, screenY - size / 2, size, size);
        }
    }

    function drawDigIndicator() {
        const q = state.queen;
        if (!q.digging || q.digTimer <= 0 || q.moving) return;

        // Fortschrittsanzeige ueber der Ameise
        const screenX = q.x - state.camera.x;
        const screenY = q.y - state.camera.y;
        const progress = 1 - (q.digTimer / CONFIG.DIG_DURATION);
        const barWidth = 40;
        const barHeight = 5;

        ctx.save();
        // Hintergrund
        ctx.fillStyle = '#333';
        ctx.fillRect(screenX - barWidth / 2, screenY - CONFIG.QUEEN_SIZE / 2 - 12, barWidth, barHeight);
        // Fortschritt
        ctx.fillStyle = '#8B4513';
        ctx.fillRect(screenX - barWidth / 2, screenY - CONFIG.QUEEN_SIZE / 2 - 12, barWidth * progress, barHeight);
        ctx.restore();
    }

    function drawQueen() {
        const img = state.images.queen;
        if (!img) return;

        const q = state.queen;
        const bodyLength = CONFIG.QUEEN_SIZE * 1.5; // Laenge (Kopf bis Hinterleib)
        const bodyWidth = CONFIG.QUEEN_SIZE;         // Breite (seitlich)

        // Position auf dem Bildschirm
        const screenX = q.x - state.camera.x;
        const screenY = q.y - state.camera.y;

        ctx.save();
        ctx.translate(screenX, screenY);
        // Rotation: Bild zeigt nach rechts (0), daher kein Offset noetig
        ctx.rotate(q.angle);
        ctx.drawImage(img, -bodyLength / 2, -bodyWidth / 2, bodyLength, bodyWidth);
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

    function drawUnderground() {
        const img = state.images.underground;
        if (!img) return;

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Hinweis zum Verlassen
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, canvas.height - 60 * window.devicePixelRatio, canvas.width, 60 * window.devicePixelRatio);
        ctx.fillStyle = '#ffcc00';
        ctx.font = (14 * window.devicePixelRatio) + 'px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Tippen zum Verlassen', canvas.width / 2, canvas.height - 20 * window.devicePixelRatio);
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
        const viewW = (canvas.width / CONFIG.ZOOM / CONFIG.WORLD_WIDTH) * mapW;
        const viewH = (canvas.height / CONFIG.ZOOM / CONFIG.WORLD_HEIGHT) * mapH;

        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(viewX, viewY, viewW, viewH);

        // Loecher auf Minimap
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = '#8B4513';
        for (let i = 0; i < state.holes.length; i++) {
            const h = state.holes[i];
            const holeMapX = x + (h.x / CONFIG.WORLD_WIDTH) * mapW;
            const holeMapY = y + (h.y / CONFIG.WORLD_HEIGHT) * mapH;
            ctx.beginPath();
            ctx.arc(holeMapX, holeMapY, 2, 0, Math.PI * 2);
            ctx.fill();
        }

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

        if (state.underground.active) {
            // Untergrund-Ansicht
            drawUnderground();
        } else {
            // Zoom anwenden fuer Spielwelt
            ctx.save();
            ctx.scale(CONFIG.ZOOM, CONFIG.ZOOM);
            drawGrass();
            drawHoles();
            drawTargetMarker();
            drawQueen();
            drawDigIndicator();
            ctx.restore();

            // Minimap ohne Zoom zeichnen
            drawMinimap();
        }

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
