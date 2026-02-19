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

        // Untergrund-Welt
        UNDERGROUND_WIDTH: 3000,   // Breite der Untergrund-Welt in Pixeln
        UNDERGROUND_HEIGHT: 3000,  // Tiefe der Untergrund-Welt in Pixeln
        UNDERGROUND_TOP_HEIGHT: 350, // Hoehe des oberen Streifens (underground.png)
        TUNNEL_RADIUS: 50,         // Halbe Breite eines Gangs in Welt-Pixeln
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
        underground: {
            active: false,
            camX: 0, camY: 0,
            queenX: 1500, queenY: 162,  // Ameisenposition im Untergrund
            queenAngle: Math.PI / 2,
            targetX: null, targetY: null,
            moving: false,
            exitX: 1500, exitY: 100,    // Hoehleneingang-Position (tief in der Erde)
            goingToExit: false,
            tunnels: [],               // Gegrabene Gaenge: [{x1,y1,x2,y2}]
            currentDig: null,          // Aktuell gegrabener Gang: {x1,y1} (Endpunkt = Ameisenpos.)
            lastTapTime: 0,            // Doppelklick-Erkennung im Untergrund
            lastTapX: 0,
            lastTapY: 0,
        }, // Untergrund-Ansicht
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

            // Optional: Tiefes Erdreich laden (wird benoetigt sobald underground_deep.png hochgeladen ist)
            loadImage('assets/images/underground_deep.png')
                .then(img => { state.images.underground_deep = img; })
                .catch(() => { /* Datei noch nicht vorhanden - Untergrund zeigt nur den oberen Streifen */ });
        } catch (e) {
            document.getElementById('loading').innerHTML =
                '<div style="text-align:center;padding:20px;">' +
                '<p style="color:#ff6b6b;margin-bottom:12px;">Fehler beim Laden der Grafiken!</p>' +
                '<p style="font-size:13px;color:#aaa;margin-bottom:16px;">' + e.message + '</p>' +
                '<button id="clearCacheBtn" style="background:#4a7a2a;color:#fff;border:none;' +
                'padding:12px 24px;font-size:15px;border-radius:6px;cursor:pointer;">' +
                'Cache leeren &amp; neu laden</button>' +
                '</div>';
            document.getElementById('clearCacheBtn').addEventListener('click', function () {
                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.getRegistrations().then(function (regs) {
                        var deletes = regs.map(function (r) { return r.unregister(); });
                        return Promise.all(deletes);
                    }).then(function () {
                        return caches.keys();
                    }).then(function (keys) {
                        return Promise.all(keys.map(function (k) { return caches.delete(k); }));
                    }).then(function () {
                        location.reload(true);
                    });
                } else {
                    location.reload(true);
                }
            });
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

    // --- Hilfsfunktion: Naechster Punkt auf dem Tunnel-Netzwerk ---
    function closestPointOnTunnels(px, py, tunnels) {
        let bestX = px, bestY = py, bestDist = Infinity;
        for (let i = 0; i < tunnels.length; i++) {
            const seg = tunnels[i];
            const dx = seg.x2 - seg.x1;
            const dy = seg.y2 - seg.y1;
            const lenSq = dx * dx + dy * dy;
            if (lenSq === 0) continue;
            let t = ((px - seg.x1) * dx + (py - seg.y1) * dy) / lenSq;
            t = Math.max(0, Math.min(1, t));
            const cx = seg.x1 + t * dx;
            const cy = seg.y1 + t * dy;
            const dist = Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
            if (dist < bestDist) {
                bestDist = dist;
                bestX = cx;
                bestY = cy;
            }
        }
        return {x: bestX, y: bestY, dist: bestDist};
    }

    // --- Tap-Verarbeitung (Einzelklick vs. Doppelklick) ---
    function handleTap(worldX, worldY) {
        // Untergrund-Ansicht: Ameise steuern, Gaenge graben, Ausgang benutzen
        if (state.underground.active) {
            const u = state.underground;

            // Ausgang antippen -> laufendes Graben abschliessen + nach oben gehen
            const dxExit = worldX - u.exitX;
            const dyExit = worldY - u.exitY;
            if (Math.sqrt(dxExit * dxExit + dyExit * dyExit) < 90) {
                if (u.currentDig) {
                    u.tunnels.push({x1: u.currentDig.x1, y1: u.currentDig.y1, x2: u.queenX, y2: u.queenY});
                    u.currentDig = null;
                }
                u.targetX = u.exitX;
                u.targetY = u.exitY + 15;
                u.moving = true;
                u.goingToExit = true;
                u.lastTapTime = 0;
                return;
            }

            // Doppelklick-Erkennung
            const now = Date.now();
            const dt = now - u.lastTapTime;
            const tapDx = worldX - u.lastTapX;
            const tapDy = worldY - u.lastTapY;
            const tapDist = Math.sqrt(tapDx * tapDx + tapDy * tapDy);

            if (dt < CONFIG.DOUBLE_TAP_DELAY && tapDist < CONFIG.DOUBLE_TAP_RADIUS) {
                // Doppelklick: laufendes Graben abschliessen, neues starten
                if (u.currentDig) {
                    u.tunnels.push({x1: u.currentDig.x1, y1: u.currentDig.y1, x2: u.queenX, y2: u.queenY});
                }
                u.lastTapTime = 0; // Reset, kein Triple-Tap
                const tx = Math.max(0, Math.min(worldX, CONFIG.UNDERGROUND_WIDTH));
                const ty = Math.max(u.exitY, Math.min(worldY, CONFIG.UNDERGROUND_HEIGHT));
                // Neues Graben startet an aktueller Ameisenposition
                u.currentDig = {x1: u.queenX, y1: u.queenY};
                u.targetX = tx;
                u.targetY = ty;
                u.moving = true;
                u.goingToExit = false;
            } else {
                // Einfacher Tap: laufendes Graben abschliessen + auf vorhandenem Gang bewegen
                u.lastTapTime = now;
                u.lastTapX = worldX;
                u.lastTapY = worldY;
                if (u.currentDig) {
                    u.tunnels.push({x1: u.currentDig.x1, y1: u.currentDig.y1, x2: u.queenX, y2: u.queenY});
                    u.currentDig = null;
                }
                const cp = closestPointOnTunnels(worldX, worldY, u.tunnels);
                if (cp.dist <= CONFIG.TUNNEL_RADIUS * 2.5) {
                    u.targetX = cp.x;
                    u.targetY = cp.y;
                    u.moving = true;
                    u.goingToExit = false;
                }
                // Tap ausserhalb aller Gaenge: ignorieren
            }
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
        // Je nach Ansicht den richtigen Kamera-Startpunkt merken
        state.touch.cameraStartX = state.underground.active ? state.underground.camX : state.camera.x;
        state.touch.cameraStartY = state.underground.active ? state.underground.camY : state.camera.y;
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
            if (state.underground.active) {
                state.underground.camX = state.touch.cameraStartX - dx / CONFIG.ZOOM;
                state.underground.camY = state.touch.cameraStartY - dy / CONFIG.ZOOM;
            } else {
                state.camera.x = state.touch.cameraStartX - dx / CONFIG.ZOOM;
                state.camera.y = state.touch.cameraStartY - dy / CONFIG.ZOOM;
            }
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
            let worldX, worldY;
            if (state.underground.active) {
                worldX = scaled.x / CONFIG.ZOOM + state.underground.camX;
                worldY = scaled.y / CONFIG.ZOOM + state.underground.camY;
            } else {
                worldX = scaled.x / CONFIG.ZOOM + state.camera.x;
                worldY = scaled.y / CONFIG.ZOOM + state.camera.y;
            }
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
        mouseCamStartX = state.underground.active ? state.underground.camX : state.camera.x;
        mouseCamStartY = state.underground.active ? state.underground.camY : state.camera.y;
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
            if (state.underground.active) {
                state.underground.camX = mouseCamStartX - dx / CONFIG.ZOOM;
                state.underground.camY = mouseCamStartY - dy / CONFIG.ZOOM;
            } else {
                state.camera.x = mouseCamStartX - dx / CONFIG.ZOOM;
                state.camera.y = mouseCamStartY - dy / CONFIG.ZOOM;
            }
        }
    });

    canvas.addEventListener('mouseup', (e) => {
        if (!mouseDragging) {
            const mx = e.clientX * window.devicePixelRatio;
            const my = e.clientY * window.devicePixelRatio;
            let worldX, worldY;
            if (state.underground.active) {
                worldX = mx / CONFIG.ZOOM + state.underground.camX;
                worldY = my / CONFIG.ZOOM + state.underground.camY;
            } else {
                worldX = mx / CONFIG.ZOOM + state.camera.x;
                worldY = my / CONFIG.ZOOM + state.camera.y;
            }
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
                const u = state.underground;
                // Ausgang-X proportional zur Loch-Position auf der Oberflaeche
                const exitX = q.x * (CONFIG.UNDERGROUND_WIDTH / CONFIG.WORLD_WIDTH);
                u.exitX = Math.max(CONFIG.QUEEN_SIZE, Math.min(exitX, CONFIG.UNDERGROUND_WIDTH - CONFIG.QUEEN_SIZE));
                u.exitY = 100; // tiefer in der Erdschicht als die Rasenkante
                // Ameise startet knapp unterhalb des Hoehleneingangs (gerade eingetreten)
                u.queenX = u.exitX;
                u.queenY = u.exitY + 62; // direkt unter dem Ausgangsoval
                u.queenAngle = Math.PI / 2; // schaut nach unten
                u.targetX = null;
                u.targetY = null;
                u.moving = false;
                u.goingToExit = false;
                // Eingangs-Gang: senkrecht von Ausgangsoval bis zur Startposition der Ameise
                u.tunnels = [{x1: u.exitX, y1: u.exitY, x2: u.exitX, y2: u.queenY}];
                u.currentDig = null;
                u.lastTapTime = 0;
                u.lastTapX = 0;
                u.lastTapY = 0;
                // Kamera so setzen, dass Eingang und Ameise sichtbar sind
                const viewW = canvas.width / CONFIG.ZOOM;
                const viewH = canvas.height / CONFIG.ZOOM;
                u.camX = Math.max(0, Math.min(u.exitX - viewW / 2, CONFIG.UNDERGROUND_WIDTH - viewW));
                u.camY = 0;
                u.active = true;
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

    // --- Ameisen-Logik im Untergrund ---
    function updateUndergroundQueen() {
        const u = state.underground;
        if (!u.moving || u.targetX === null) return;

        const dx = u.targetX - u.queenX;
        const dy = u.targetY - u.queenY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < CONFIG.MOVE_DEAD_ZONE) {
            // Gegrabenen Gang abschliessen (Endpunkt = Zielposition)
            if (u.currentDig) {
                u.tunnels.push({x1: u.currentDig.x1, y1: u.currentDig.y1, x2: u.queenX, y2: u.queenY});
                u.currentDig = null;
            }
            u.moving = false;
            u.targetX = null;
            u.targetY = null;
            if (u.goingToExit) {
                u.goingToExit = false;
                u.active = false; // Zurueck zur Oberflaechenansicht
            }
            return;
        }

        u.queenAngle = Math.atan2(dy, dx);
        u.queenX += (dx / dist) * CONFIG.QUEEN_SPEED;
        u.queenY += (dy / dist) * CONFIG.QUEEN_SPEED;

        // Weltgrenzen
        u.queenX = Math.max(CONFIG.QUEEN_SIZE / 2, Math.min(u.queenX, CONFIG.UNDERGROUND_WIDTH - CONFIG.QUEEN_SIZE / 2));
        u.queenY = Math.max(u.exitY, Math.min(u.queenY, CONFIG.UNDERGROUND_HEIGHT - CONFIG.QUEEN_SIZE / 2));
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

    function updateUndergroundCamera() {
        const u = state.underground;
        const viewW = canvas.width / CONFIG.ZOOM;
        const viewH = canvas.height / CONFIG.ZOOM;
        // Kamera folgt der Ameise, wenn kein Drag aktiv
        if (!state.touch.isDragging && !mouseDragging) {
            u.camX = u.queenX - viewW / 2;
            u.camY = u.queenY - viewH / 2;
        }
        u.camX = Math.max(0, Math.min(u.camX, CONFIG.UNDERGROUND_WIDTH - viewW));
        u.camY = Math.max(0, Math.min(u.camY, CONFIG.UNDERGROUND_HEIGHT - viewH));
    }

    function drawUnderground() {
        const u = state.underground;
        const topImg = state.images.underground;
        const soilImg = state.images.underground_deep;
        const camX = u.camX;
        const camY = u.camY;
        const worldW = CONFIG.UNDERGROUND_WIDTH;
        const topH = CONFIG.UNDERGROUND_TOP_HEIGHT;
        const pulse = Math.sin(Date.now() / 420) * 0.2 + 0.8;

        ctx.save();
        ctx.scale(CONFIG.ZOOM, CONFIG.ZOOM);

        // Oberer Streifen: underground.png gestreckt auf volle Weltbreite
        if (topImg) {
            ctx.drawImage(topImg, -camX, -camY, worldW, topH);
        }

        // Darunter: underground_deep.png als Kachelwerk fuer die Tiefe
        if (soilImg && soilImg.width > 0 && soilImg.height > 0) {
            const tileW = soilImg.width;
            const tileH = soilImg.height;
            const viewW = canvas.width / CONFIG.ZOOM;
            const viewH = canvas.height / CONFIG.ZOOM;
            const soilCamY = camY - topH;
            const startCol = Math.floor(camX / tileW);
            const endCol = Math.ceil((camX + viewW) / tileW);
            const startRow = Math.max(0, Math.floor(soilCamY / tileH));
            const endRow = Math.ceil((soilCamY + viewH) / tileH);
            for (let row = startRow; row <= endRow; row++) {
                for (let col = startCol; col <= endCol; col++) {
                    const screenX = col * tileW - camX;
                    const screenY = topH + row * tileH - camY;
                    ctx.drawImage(soilImg, screenX, screenY, tileW, tileH);
                }
            }
        }

        // --- Gaenge zeichnen (ueber Erde, unter Ameise) ---
        // Alle Segmente: abgeschlossene Gaenge + aktuell gegrabener (waechst mit Ameise)
        const allSegs = u.tunnels.slice();
        if (u.currentDig) {
            allSegs.push({x1: u.currentDig.x1, y1: u.currentDig.y1, x2: u.queenX, y2: u.queenY});
        }
        if (allSegs.length > 0) {
            const r = CONFIG.TUNNEL_RADIUS;
            ctx.save();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            // Aeusserer Erdrand (dunklerer Rand)
            ctx.strokeStyle = '#0e0700';
            ctx.lineWidth = r * 2 + 8;
            for (let i = 0; i < allSegs.length; i++) {
                const seg = allSegs[i];
                ctx.beginPath();
                ctx.moveTo(seg.x1 - camX, seg.y1 - camY);
                ctx.lineTo(seg.x2 - camX, seg.y2 - camY);
                ctx.stroke();
            }
            // Tunnel-Hohlraum (dunkles Erdreich-Inneres)
            ctx.strokeStyle = '#241005';
            ctx.lineWidth = r * 2;
            for (let i = 0; i < allSegs.length; i++) {
                const seg = allSegs[i];
                ctx.beginPath();
                ctx.moveTo(seg.x1 - camX, seg.y1 - camY);
                ctx.lineTo(seg.x2 - camX, seg.y2 - camY);
                ctx.stroke();
            }
            ctx.restore();
        }

        // --- Hoehleneingang (Ausgang nach oben) ---
        const exitScrX = u.exitX - camX;
        const exitScrY = u.exitY - camY;
        const tunnelW = 80;
        const tunnelH = 48;

        // Lichtschein von der Oberflaeche (Tageslicht-Glow)
        const glow = ctx.createRadialGradient(exitScrX, exitScrY, 0, exitScrX, exitScrY, 110);
        glow.addColorStop(0, 'rgba(160, 255, 80, ' + (0.45 * pulse) + ')');
        glow.addColorStop(0.5, 'rgba(100, 200, 40, ' + (0.2 * pulse) + ')');
        glow.addColorStop(1, 'rgba(100, 200, 40, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.ellipse(exitScrX, exitScrY, 110, 90, 0, 0, Math.PI * 2);
        ctx.fill();

        // Dunkelheit des Tunnelinneren
        ctx.fillStyle = '#0b0600';
        ctx.beginPath();
        ctx.ellipse(exitScrX, exitScrY, tunnelW / 2, tunnelH / 2, 0, 0, Math.PI * 2);
        ctx.fill();

        // Tunnel-Wand (Erdreich-Rand)
        ctx.strokeStyle = '#7a5010';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.ellipse(exitScrX, exitScrY, tunnelW / 2, tunnelH / 2, 0, 0, Math.PI * 2);
        ctx.stroke();

        // Helle Innenkontur (Lichtreflex)
        ctx.strokeStyle = 'rgba(200, 160, 60, 0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(exitScrX, exitScrY - 3, tunnelW / 2 - 4, tunnelH / 2 - 4, 0, 0, Math.PI * 2);
        ctx.stroke();

        // Pfeile nach oben neben dem Eingang
        ctx.fillStyle = 'rgba(255, 210, 60, ' + pulse + ')';
        ctx.beginPath();
        // Linker Pfeil
        ctx.moveTo(exitScrX - tunnelW / 2 - 16, exitScrY + 4);
        ctx.lineTo(exitScrX - tunnelW / 2 - 8, exitScrY - 10);
        ctx.lineTo(exitScrX - tunnelW / 2 - 0, exitScrY + 4);
        ctx.closePath();
        ctx.fill();
        // Rechter Pfeil
        ctx.beginPath();
        ctx.moveTo(exitScrX + tunnelW / 2 + 0, exitScrY + 4);
        ctx.lineTo(exitScrX + tunnelW / 2 + 8, exitScrY - 10);
        ctx.lineTo(exitScrX + tunnelW / 2 + 16, exitScrY + 4);
        ctx.closePath();
        ctx.fill();

        // "Ausgang"-Label in passender Schriftgroesse
        const labelSize = Math.round(13 * window.devicePixelRatio / CONFIG.ZOOM);
        ctx.font = 'bold ' + labelSize + 'px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255, 220, 60, ' + pulse + ')';
        ctx.fillText('Ausgang', exitScrX, exitScrY + tunnelH / 2 + labelSize + 4);

        // --- Zielmarkierung der Untergrund-Ameise ---
        if (u.moving && u.targetX !== null && !u.goingToExit) {
            const tScrX = u.targetX - camX;
            const tScrY = u.targetY - camY;
            const tPulse = Math.sin(Date.now() / 200) * 0.3 + 0.7;
            ctx.save();
            ctx.globalAlpha = tPulse * 0.5;
            ctx.strokeStyle = '#ffcc00';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(tScrX, tScrY, 12 + tPulse * 6, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        // --- Ameise im Untergrund ---
        const queenImg = state.images.queen;
        if (queenImg) {
            const scrX = u.queenX - camX;
            const scrY = u.queenY - camY;
            const bodyLength = CONFIG.QUEEN_SIZE * 1.5;
            const bodyWidth = CONFIG.QUEEN_SIZE;
            ctx.save();
            ctx.translate(scrX, scrY);
            ctx.rotate(u.queenAngle);
            ctx.drawImage(queenImg, -bodyLength / 2, -bodyWidth / 2, bodyLength, bodyWidth);
            ctx.restore();
        }

        ctx.restore(); // Ende des ZOOM-Blocks

        // --- UI-Hinweis unten (in Canvas-Pixeln) ---
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, canvas.height - 56 * window.devicePixelRatio, canvas.width, 56 * window.devicePixelRatio);
        ctx.fillStyle = '#ffcc00';
        ctx.font = (13 * window.devicePixelRatio) + 'px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Doppeltippen: Gang graben  |  Ausgang: nach oben', canvas.width / 2, canvas.height - 18 * window.devicePixelRatio);
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

        // Rendern
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (state.underground.active) {
            // Untergrund-Ansicht: Ameise bewegen, Kamera folgt
            updateUndergroundQueen();
            updateUndergroundCamera();
            drawUnderground();
        } else {
            // Oberflaechenlogik
            updateQueen();
            updateCamera();
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
