const canvas = document.getElementById('energyCanvas');
const ctx = canvas.getContext('2d');
const { ipcRenderer } = require('electron');

// --- Configuration ---
let width, height;
const particles = [];
const params = new URLSearchParams(window.location.search);

// Parse query params for customization
const baseHue = parseInt(params.get('hue')) || 120; // Default green
const speedMultiplier = parseFloat(params.get('speed')) || 1;
const complexity = parseInt(params.get('complexity')) || 1;

// Global Physics State
let globalGravity = { x: 0, y: 0 };
let neighbors = [];

// --- Audio Reactivity ---
let audioContext, analyser, dataArray;
let globalAudio = { bass: 0, mid: 0, treble: 0, volume: 0 };

async function initAudio() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        analyser.fftSize = 256;
        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
    } catch (e) {
        console.warn('Audio input failed or denied:', e);
    }
}
initAudio();

function updateAudio() {
    if (!analyser) return;
    analyser.getByteFrequencyData(dataArray);

    // Simple frequency banding
    let bassSum = 0, midSum = 0, trebleSum = 0;
    const binCount = dataArray.length;

    for (let i = 0; i < binCount; i++) {
        const val = dataArray[i] / 255.0;
        if (i < binCount * 0.1) bassSum += val;
        else if (i < binCount * 0.5) midSum += val;
        else trebleSum += val;
    }

    globalAudio.bass = bassSum / (binCount * 0.1);
    globalAudio.mid = midSum / (binCount * 0.4);
    globalAudio.treble = trebleSum / (binCount * 0.5);
    globalAudio.volume = (bassSum + midSum + trebleSum) / binCount;
}

// --- Resize Handling ---
function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
}
window.addEventListener('resize', resize);
resize();

// --- IPC Listeners ---
ipcRenderer.on('update-state', (event, state) => {
    globalGravity = state.gravity;
    neighbors = state.neighbors;
});

ipcRenderer.on('spawn-particle', (event, { x, y, vx, vy, behavior, offset, hue }) => {
    const p = new Particle(x, y, 'flare');
    p.vx = vx;
    p.vy = vy;
    p.life = 1.0;
    p.behavior = 'absorbing';
    p.offset = offset || 0;
    p.hue = hue || baseHue;
    particles.push(p);
});

// --- Visual Effects ---

function drawBackgroundGrid(ctx) {
    const spacing = 40;
    const centerX = width / 2;
    const centerY = height / 2;
    const time = performance.now() * 0.001;

    ctx.strokeStyle = `hsla(${baseHue}, 50%, 20%, 0.2)`;
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let x = 0; x <= width; x += spacing) {
        for (let y = 0; y <= height; y += spacing) {
            // Distortion Logic (Gravity Well)
            const dx = x - centerX;
            const dy = y - centerY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Pull towards center
            // Stronger pull closer to center
            const pull = Math.max(0, (1 - dist / 600) * 20 * (1 + globalAudio.bass));

            const distFactor = dist > 0 ? 1 : 0;
            const gx = x - (dx / dist) * pull * distFactor;
            const gy = y - (dy / dist) * pull * distFactor;

            // Draw small cross or dot
            ctx.moveTo(gx - 2, gy);
            ctx.lineTo(gx + 2, gy);
            ctx.moveTo(gx, gy - 2);
            ctx.lineTo(gx, gy + 2);
        }
    }
    ctx.stroke();
}

function drawLightning(ctx, startX, startY, endX, endY, intensity) {
    const dx = endX - startX;
    const dy = endY - startY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 10) return;

    const steps = Math.floor(dist / 10);
    let currX = startX;
    let currY = startY;

    ctx.beginPath();
    ctx.moveTo(startX, startY);

    for (let i = 0; i < steps; i++) {
        const t = (i + 1) / steps;
        const targetX = startX + dx * t;
        const targetY = startY + dy * t;

        // Jitter perpendicular to direction
        const jitter = (Math.random() - 0.5) * 20 * intensity;
        // Perpendicular vector (-dy, dx)
        const perpX = -dy / dist;
        const perpY = dx / dist;

        currX = targetX + perpX * jitter;
        currY = targetY + perpY * jitter;

        ctx.lineTo(currX, currY);
    }
    ctx.lineTo(endX, endY);

    ctx.shadowBlur = 20 * intensity;
    ctx.shadowColor = `hsla(${baseHue}, 100%, 80%, 0.8)`;
    ctx.strokeStyle = `hsla(${baseHue}, 100%, 90%, ${intensity})`;
    ctx.lineWidth = 2 * intensity;
    ctx.stroke();
    ctx.shadowBlur = 0; // Reset
}

// --- Particle Class ---
class Particle {
    constructor(x, y, type, behavior = 'halo') {
        this.x = x;
        this.y = y;
        this.type = type;
        this.char = Math.floor(Math.random() * 10).toString(); // Random digit 0-9
        this.behavior = behavior;
        this.offset = Math.random() * 100;
        this.initialLife = 1.0;
        this.life = 1.0;
        this.decay = Math.random() * 0.01 + 0.005;
        this.hue = baseHue;

        const angle = Math.random() * Math.PI * 2;
        const speed = (Math.random() * 2 + 1) * speedMultiplier;

        if (this.behavior === 'halo') {
            this.vx = Math.cos(angle) * speed * 0.5;
            this.vy = Math.sin(angle) * speed * 0.5;
        } else if (this.behavior === 'flow') {
            this.vx = (Math.random() - 0.5) * 2;
            this.vy = -Math.random() * 5 - 2;
        } else {
            this.vx = Math.cos(angle) * speed;
            this.vy = Math.sin(angle) * speed;
        }

        this.history = [];
        this.maxHistory = 10;
    }

    update(time) {
        const centerX = width / 2;
        const centerY = height / 2;

        // Audio Reactivity: Shimmer/Speed
        const shimmer = 1 + globalAudio.treble * 0.5;

        if (this.behavior === 'halo') {
            const dx = this.x - centerX;
            const dy = this.y - centerY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Audio Reactivity: Pulse Radius
            // Double size: Base radius 120
            const radius = 120 + globalAudio.bass * 60;

            if (dist > radius) {
                const force = (dist - radius) * 0.05;
                this.vx -= (dx / dist) * force;
                this.vy -= (dy / dist) * force;
            }
            this.vx += (dy / dist) * 0.1 * shimmer;
            this.vy -= (dx / dist) * 0.1 * shimmer;
            this.vx *= 0.98;
            this.vy *= 0.98;

        } else if (this.behavior === 'flow') {
            const age = 1.0 - this.life;
            const basePhase = 0.3;

            if (age < basePhase) {
                this.vy -= 0.1;
                this.vx *= 0.95;
                this.vy *= 0.95;
            } else {
                // If neighbors exist, attract. Else, just float up/out.
                if (neighbors.length > 0) {
                    this.vx += globalGravity.x * 0.35;
                    this.vy += globalGravity.y * 0.35;
                } else {
                    // Solar Flare behavior: Random upward/outward drift
                    // Add some noise
                    this.vx += (Math.random() - 0.5) * 0.1;
                    this.vy += (Math.random() - 0.5) * 0.1 - 0.05; // Slight upward bias
                }

                let angle = Math.atan2(this.vy, this.vx);
                const wiggle = Math.sin(time * 0.1 + this.offset) * 0.5 * shimmer;
                this.vx += Math.cos(angle + Math.PI / 2) * wiggle;
                this.vy += Math.sin(angle + Math.PI / 2) * wiggle;
            }

        } else if (this.behavior === 'absorbing') {
            const dx = centerX - this.x;
            const dy = centerY - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            const tangentX = -dy / dist;
            const tangentY = dx / dist;
            const spiral = Math.sin(time * 0.2 + this.offset) * 2.0;

            if (dist > 20) {
                this.vx += (dx / dist) * 0.5;
                this.vy += (dy / dist) * 0.5;
                this.vx += tangentX * spiral * 0.1;
                this.vy += tangentY * spiral * 0.1;
            } else {
                this.life -= 0.1;
            }
            this.vx *= 0.95;
            this.vy *= 0.95;
        }

        this.x += this.vx;
        this.y += this.vy;

        if (this.behavior === 'flow') {
            let bounced = false;
            if (this.x < 0) { if (this.tryTransfer()) return true; this.x = 0; this.vx *= -1; bounced = true; }
            else if (this.x > width) { if (this.tryTransfer()) return true; this.x = width; this.vx *= -1; bounced = true; }
            if (this.y < 0) { if (this.tryTransfer()) return true; this.y = 0; this.vy *= -1; bounced = true; }
            else if (this.y > height) { if (this.tryTransfer()) return true; this.y = height; this.vy *= -1; bounced = true; }
        } else if (this.behavior !== 'absorbing') {
            if (this.x < 0 || this.x > width) this.vx *= -1;
            if (this.y < 0 || this.y > height) this.vy *= -1;
        }

        this.history.push({ x: this.x, y: this.y });
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        }

        this.life -= this.decay;
        return false;
    }

    tryTransfer() {
        if (neighbors.length > 0) {
            ipcRenderer.send('particle-exit', {
                x: this.x,
                y: this.y,
                vx: this.vx,
                vy: this.vy,
                behavior: this.behavior,
                offset: this.offset,
                hue: this.hue
            });
            return true;
        }
        return false;
    }

    draw(ctx) {
        ctx.font = '14px monospace';

        // Rapidly changing digits
        this.char = Math.floor(Math.random() * 10).toString();

        // Audio Reactivity: Brightness
        const brightness = 50 + globalAudio.mid * 20;

        for (let i = 0; i < this.history.length; i++) {
            const pos = this.history[i];
            const alpha = (i / this.history.length) * this.life * 0.5;
            ctx.fillStyle = `hsla(${this.hue}, 100%, ${brightness}%, ${alpha})`;
            ctx.fillText(this.char, pos.x, pos.y);
        }

        ctx.fillStyle = `hsla(${this.hue}, 100%, ${brightness + 20}%, ${this.life})`;
        ctx.fillText(this.char, this.x, this.y);
    }
}

// --- Energy Ball Logic ---
class EnergyBall {
    constructor() {
        this.x = width / 2;
        this.y = height / 2;
        this.time = 0;
        this.coreParticles = [];
        // Increase core particle count for larger ball
        for (let i = 0; i < 600; i++) {
            this.coreParticles.push({
                x: (Math.random() - 0.5) * 200, // Relative to center, larger spread
                y: (Math.random() - 0.5) * 200,
                vx: (Math.random() - 0.5) * 2,
                vy: (Math.random() - 0.5) * 2,
                char: Math.floor(Math.random() * 10).toString()
            });
        }
    }

    update() {
        this.x = width / 2;
        this.y = height / 2;
        this.time++;

        // Audio Reactivity: Pulse Radius
        // Double size: Base 120
        const pulse = 20 + globalAudio.bass * 20;
        const outerRadius = 120 + globalAudio.bass * 60;

        // Update Core Particles
        this.coreParticles.forEach(p => {
            // Jitter
            p.x += p.vx;
            p.y += p.vy;

            // Containment
            const dist = Math.sqrt(p.x * p.x + p.y * p.y);
            if (dist > outerRadius) {
                p.x *= 0.9;
                p.y *= 0.9;
                p.vx *= -1;
                p.vy *= -1;
            }

            // Random movement
            p.vx += (Math.random() - 0.5) * 0.2;
            p.vy += (Math.random() - 0.5) * 0.2;
            p.vx *= 0.95;
            p.vy *= 0.95;

            // Rapidly change char
            p.char = Math.floor(Math.random() * 10).toString();
        });

        const excitement = Math.abs(globalGravity.x) + Math.abs(globalGravity.y);
        const audioFactor = 1 + globalAudio.volume * 2;
        const count = (1 * complexity + Math.floor(excitement * 0.5)) * audioFactor;

        for (let i = 0; i < count; i++) {
            // Solar Flares: Always have a chance to spawn flow particles
            // If neighbors exist, 50% chance. If not, maybe 30% chance for flares.
            const spawnFlow = neighbors.length > 0 ? Math.random() > 0.5 : Math.random() > 0.7;

            if (spawnFlow) {
                const angle = Math.random() * Math.PI * 2;
                const r = outerRadius;
                const sx = this.x + Math.cos(angle) * r;
                const sy = this.y + Math.sin(angle) * r;

                const p = new Particle(sx, sy, 'flare', 'flow');

                if (neighbors.length > 0) {
                    const target = neighbors[Math.floor(Math.random() * neighbors.length)];
                    const tx = target.dx / target.dist;
                    const ty = target.dy / target.dist;
                    p.vx = tx * 8;
                    p.vy = ty * 8;
                } else {
                    // Solar Flare: Random outward burst
                    p.vx = Math.cos(angle) * 4;
                    p.vy = Math.sin(angle) * 4;
                }

                p.offset = this.time * 0.2;
                particles.push(p);

            } else {
                const r = Math.random() * outerRadius;
                const angle = Math.random() * Math.PI * 2;
                const sx = this.x + Math.cos(angle) * r;
                const sy = this.y + Math.sin(angle) * r;

                const p = new Particle(sx, sy, 'flare', 'halo');
                particles.push(p);
            }
        }
    }

    draw(ctx) {
        ctx.font = '16px monospace';
        ctx.shadowBlur = 30 + globalAudio.treble * 20;
        ctx.shadowColor = `hsla(${baseHue}, 100%, 50%, 0.8)`;

        // Draw Core Particles
        this.coreParticles.forEach(p => {
            ctx.fillStyle = `hsla(${baseHue}, 100%, 80%, 0.9)`;
            ctx.fillText(p.char, this.x + p.x, this.y + p.y);
        });

        ctx.shadowBlur = 0; // Reset
    }
}

const ball = new EnergyBall();

// --- Animation Loop ---
let frame = 0;
function animate() {
    frame++;
    updateAudio();

    // Bloom Effect: Darken with low opacity to create trails/glow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(0, 0, width, height);

    drawBackgroundGrid(ctx);

    ball.update();
    ball.draw(ctx);

    // Draw Lightning to Neighbors
    if (neighbors.length > 0) {
        neighbors.forEach(n => {
            // Threshold for lightning: Close enough
            if (n.dist < 600) {
                // Intensity based on proximity and audio
                const intensity = (1 - n.dist / 600) * (0.5 + globalAudio.treble);
                drawLightning(ctx, width / 2, height / 2, width / 2 + n.dx, height / 2 + n.dy, intensity);
            }
        });
    }

    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        const removed = p.update(frame);
        if (removed || p.life <= 0) {
            particles.splice(i, 1);
        } else {
            p.draw(ctx);
        }
    }

    requestAnimationFrame(animate);
}

animate();

// --- Spawn Button ---
document.getElementById('spawnBtn').addEventListener('click', () => {
    ipcRenderer.send('spawn-ball');
});
