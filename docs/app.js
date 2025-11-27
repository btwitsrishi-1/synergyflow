const canvas = document.getElementById('energyCanvas');
const ctx = canvas.getContext('2d');

// --- Configuration ---
let width, height;
const particles = [];
const params = new URLSearchParams(window.location.search);

// Parse query params for customization
const baseHue = parseInt(params.get('hue')) || Math.floor(Math.random() * 360);
const speedMultiplier = parseFloat(params.get('speed')) || 1;
const complexity = parseInt(params.get('complexity')) || 1;

// Global Physics State
let globalGravity = { x: 0, y: 0 };
let neighbors = [];

// --- Resize Handling ---
function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
}
window.addEventListener('resize', resize);
resize();

// --- SharedWorker Connection ---
const worker = new SharedWorker('worker.js');
worker.port.start();

worker.port.onmessage = (e) => {
    const data = e.data;
    if (data.type === 'update-state') {
        globalGravity = data.gravity;
        neighbors = data.neighbors;
    } else if (data.type === 'spawn-particle') {
        const { x, y, vx, vy, behavior, offset, hue } = data.payload;
        const p = new Particle(x, y, 'flare');
        p.vx = vx;
        p.vy = vy;
        p.life = 1.0;
        p.behavior = 'absorbing'; // Flow to center
        p.offset = offset || 0;
        p.hue = hue || baseHue;
        particles.push(p);
    }
};

// Heartbeat Loop (Sync Position)
setInterval(() => {
    worker.port.postMessage({
        type: 'heartbeat',
        bounds: {
            x: window.screenX,
            y: window.screenY,
            width: window.outerWidth,
            height: window.outerHeight
        }
    });
}, 100);

// --- Particle Class ---
class Particle {
    constructor(x, y, type, behavior = 'halo') {
        this.x = x;
        this.y = y;
        this.type = type;
        this.char = Math.random() > 0.5 ? '0' : '1';
        this.behavior = behavior; // 'halo', 'flow', 'absorbing'
        this.offset = Math.random() * 100;
        this.initialLife = 1.0;
        this.life = 1.0;
        this.decay = Math.random() * 0.01 + 0.005;
        this.hue = baseHue;

        // Initial Physics
        const angle = Math.random() * Math.PI * 2;
        const speed = (Math.random() * 2 + 1) * speedMultiplier;

        if (this.behavior === 'halo') {
            this.vx = Math.cos(angle) * speed * 0.5;
            this.vy = Math.sin(angle) * speed * 0.5;
        } else if (this.behavior === 'flow') {
            // Initial upward/outward burst for tentacles
            this.vx = (Math.random() - 0.5) * 2;
            this.vy = -Math.random() * 5 - 2;
        } else {
            this.vx = Math.cos(angle) * speed;
            this.vy = Math.sin(angle) * speed;
        }

        // Trail
        this.history = [];
        this.maxHistory = 10;
    }

    update(time) {
        const centerX = width / 2;
        const centerY = height / 2;

        if (this.behavior === 'halo') {
            // Halo Behavior: Contained within radius
            const dx = this.x - centerX;
            const dy = this.y - centerY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const radius = 80;

            if (dist > radius) {
                const force = (dist - radius) * 0.05;
                this.vx -= (dx / dist) * force;
                this.vy -= (dy / dist) * force;
            }
            this.vx += (dy / dist) * 0.1;
            this.vy -= (dx / dist) * 0.1;
            this.vx *= 0.98;
            this.vy *= 0.98;

        } else if (this.behavior === 'flow') {
            // Flow Behavior: Tentacles
            const age = 1.0 - this.life;
            const basePhase = 0.3;

            if (age < basePhase) {
                // BASE PHASE: Stable
                this.vy -= 0.1;
                this.vx *= 0.95;
                this.vy *= 0.95;
            } else {
                // TIP PHASE: Attracted to neighbors
                this.vx += globalGravity.x * 0.35;
                this.vy += globalGravity.y * 0.35;

                // Wiggle
                let angle = Math.atan2(this.vy, this.vx);
                const wiggle = Math.sin(time * 0.1 + this.offset) * 0.5;
                this.vx += Math.cos(angle + Math.PI / 2) * wiggle;
                this.vy += Math.sin(angle + Math.PI / 2) * wiggle;
            }

        } else if (this.behavior === 'absorbing') {
            // Absorbing Behavior: Flow INTO the center
            const dx = centerX - this.x;
            const dy = centerY - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Intertwining: Add spiral motion
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

        // Boundary Check & Transfer Logic
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

        // Trail history
        this.history.push({ x: this.x, y: this.y });
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        }

        this.life -= this.decay;
        return false; // Not removed
    }

    tryTransfer() {
        if (neighbors.length > 0) {
            worker.port.postMessage({
                type: 'particle-exit',
                payload: {
                    x: this.x,
                    y: this.y,
                    vx: this.vx,
                    vy: this.vy,
                    behavior: this.behavior,
                    offset: this.offset,
                    hue: this.hue
                }
            });
            return true; // Remove from local
        }
        return false;
    }

    draw(ctx) {
        ctx.font = '14px monospace';

        // Draw trail
        for (let i = 0; i < this.history.length; i++) {
            const pos = this.history[i];
            const alpha = (i / this.history.length) * this.life * 0.5;
            ctx.fillStyle = `hsla(${this.hue}, 100%, 50%, ${alpha})`;
            ctx.fillText(this.char, pos.x, pos.y);
        }

        // Draw head
        ctx.fillStyle = `hsla(${this.hue}, 100%, 70%, ${this.life})`;
        ctx.fillText(this.char, this.x, this.y);
    }
}

// --- Energy Ball Logic ---
class EnergyBall {
    constructor() {
        this.x = width / 2;
        this.y = height / 2;
        this.angle = 0;
        this.time = 0;
    }

    update() {
        this.x = width / 2;
        this.y = height / 2;
        this.angle += 0.02 * speedMultiplier;
        this.time++;

        const excitement = Math.abs(globalGravity.x) + Math.abs(globalGravity.y);
        const count = 1 * complexity + Math.floor(excitement * 0.5);

        for (let i = 0; i < count; i++) {
            // 50% Halo, 50% Flow (if neighbors exist)
            if (neighbors.length > 0 && Math.random() > 0.5) {
                // Spawn Flow Particle (Tentacle)
                const angle = Math.random() * Math.PI * 2;
                const r = 60;
                const sx = this.x + Math.cos(angle) * r;
                const sy = this.y + Math.sin(angle) * r;

                const p = new Particle(sx, sy, 'flare', 'flow');

                // Handshaking: Target a specific neighbor
                const target = neighbors[Math.floor(Math.random() * neighbors.length)];
                const tx = target.dx / target.dist;
                const ty = target.dy / target.dist;

                // Initial velocity towards target
                p.vx = tx * 8;
                p.vy = ty * 8;

                p.offset = this.time * 0.2;
                particles.push(p);

            } else {
                // Spawn Halo Particle
                const r = Math.random() * 60;
                const angle = Math.random() * Math.PI * 2;
                const sx = this.x + Math.cos(angle) * r;
                const sy = this.y + Math.sin(angle) * r;

                const p = new Particle(sx, sy, 'flare', 'halo');
                particles.push(p);
            }
        }
    }

    draw(ctx) {
        const gradient = ctx.createRadialGradient(this.x, this.y, 10, this.x, this.y, 60);
        gradient.addColorStop(0, `hsla(${baseHue}, 100%, 80%, 0.8)`);
        gradient.addColorStop(1, `hsla(${baseHue}, 100%, 50%, 0)`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(this.x, this.y, 60, 0, Math.PI * 2);
        ctx.fill();
    }
}

const ball = new EnergyBall();

// --- Animation Loop ---
let frame = 0;
function animate() {
    frame++;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(0, 0, width, height);

    ball.update();
    ball.draw(ctx);

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
