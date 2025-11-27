const canvas = document.getElementById('energyCanvas');
const ctx = canvas.getContext('2d');

// --- SharedWorker Connection ---
const worker = new SharedWorker('worker.js');
worker.port.start();

// --- Configuration ---
let width, height;
const particles = [];
const params = new URLSearchParams(window.location.search);

// Parse query params for customization
const baseHue = parseInt(params.get('hue')) || Math.floor(Math.random() * 360);
const speedMultiplier = parseFloat(params.get('speed')) || (Math.random() * 2 + 1);
const complexity = parseInt(params.get('complexity')) || (Math.floor(Math.random() * 5) + 1);

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

// --- Worker Communication ---
worker.port.onmessage = (e) => {
    const data = e.data;
    if (data.type === 'update-state') {
        globalGravity = data.gravity;
        neighbors = data.neighbors;
    } else if (data.type === 'spawn-particle') {
        const { x, y, vx, vy } = data.payload;
        const p = new Particle(x, y, 'flare');
        p.vx = vx;
        p.vy = vy;
        p.life = 1.0;
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
            width: window.outerWidth, // Use outerWidth to match screen coordinates roughly
            height: window.outerHeight
        }
    });
}, 100); // 10Hz sync is enough for window movement

// --- Particle Class ---
class Particle {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.type = type; // 'ball' or 'flare'
        this.char = Math.random() > 0.5 ? '0' : '1';

        // Initial Physics
        const angle = Math.random() * Math.PI * 2;
        const speed = (Math.random() * 2 + 1) * speedMultiplier;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;

        this.life = 1.0;
        this.decay = Math.random() * 0.01 + 0.005;

        // Trail
        this.history = [];
        this.maxHistory = 10;
    }

    update() {
        // Apply Global Gravity
        this.vx += globalGravity.x * 0.05;
        this.vy += globalGravity.y * 0.05;

        this.x += this.vx;
        this.y += this.vy;

        // Boundary Check & Transfer Logic
        let bounced = false;

        // Check Left
        if (this.x < 0) {
            if (this.tryTransfer()) return true;
            this.x = 0; this.vx *= -1; bounced = true;
        }
        // Check Right
        else if (this.x > width) {
            if (this.tryTransfer()) return true;
            this.x = width; this.vx *= -1; bounced = true;
        }
        // Check Top
        if (this.y < 0) {
            if (this.tryTransfer()) return true;
            this.y = 0; this.vy *= -1; bounced = true;
        }
        // Check Bottom
        else if (this.y > height) {
            if (this.tryTransfer()) return true;
            this.y = height; this.vy *= -1; bounced = true;
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
                    vy: this.vy
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
            ctx.fillStyle = `hsla(${baseHue}, 100%, 50%, ${alpha})`;
            ctx.fillText(this.char, pos.x, pos.y);
        }

        // Draw head
        ctx.fillStyle = `hsla(${baseHue}, 100%, 70%, ${this.life})`;
        ctx.fillText(this.char, this.x, this.y);
    }
}

// --- Energy Ball Logic ---
class EnergyBall {
    constructor() {
        this.x = width / 2;
        this.y = height / 2;
        this.angle = 0;
    }

    update() {
        this.x = width / 2;
        this.y = height / 2;
        this.angle += 0.02 * speedMultiplier;

        const excitement = Math.abs(globalGravity.x) + Math.abs(globalGravity.y);
        const count = 5 * complexity + Math.floor(excitement * 2);

        for (let i = 0; i < count; i++) {
            const p = new Particle(this.x, this.y, 'flare');
            p.vx += globalGravity.x * 2;
            p.vy += globalGravity.y * 2;
            particles.push(p);
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
function animate() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(0, 0, width, height);

    ball.update();
    ball.draw(ctx);

    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        const removed = p.update();
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
    window.open(window.location.href, '_blank', 'width=800,height=600');
});
