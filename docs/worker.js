// SharedWorker: The "Main Process" of the web version

const connections = new Map(); // port -> { id, bounds, port }
let nextId = 1;

// --- 3ms State Loop ---
setInterval(() => {
    const clients = Array.from(connections.values());

    clients.forEach(source => {
        const sourceCenter = {
            x: source.bounds.x + source.bounds.width / 2,
            y: source.bounds.y + source.bounds.height / 2
        };

        let totalForceX = 0;
        let totalForceY = 0;
        const neighbors = [];

        clients.forEach(target => {
            if (source.id === target.id) return;

            const targetCenter = {
                x: target.bounds.x + target.bounds.width / 2,
                y: target.bounds.y + target.bounds.height / 2
            };

            const dx = targetCenter.x - sourceCenter.x;
            const dy = targetCenter.y - sourceCenter.y;
            const distSq = dx * dx + dy * dy;
            const dist = Math.sqrt(distSq);

            // Gravity formula
            const safeDistSq = Math.max(distSq, 10000);
            const forceMagnitude = 500000 / safeDistSq;

            const fx = (dx / dist) * forceMagnitude;
            const fy = (dy / dist) * forceMagnitude;

            totalForceX += fx;
            totalForceY += fy;

            neighbors.push({
                id: target.id,
                dx,
                dy,
                dist
            });
        });

        source.port.postMessage({
            type: 'update-state',
            gravity: { x: totalForceX, y: totalForceY },
            neighbors
        });
    });
}, 3);

self.onconnect = (e) => {
    const port = e.ports[0];
    const id = nextId++;

    // Initial state
    connections.set(port, {
        id,
        port,
        bounds: { x: 0, y: 0, width: 800, height: 600 }
    });

    port.onmessage = (event) => {
        const data = event.data;

        if (data.type === 'heartbeat') {
            // Update window bounds reported by client
            const conn = connections.get(port);
            if (conn) {
                conn.bounds = data.bounds;
            }
        }
        else if (data.type === 'particle-exit') {
            handleParticleExit(id, data.payload);
        }
        else if (data.type === 'log') {
            console.log(`[Client ${id}]`, data.msg);
        }
    };

    port.start();
    console.log(`Client ${id} connected`);
};

function handleParticleExit(senderId, { x, y, vx, vy }) {
    const sender = Array.from(connections.values()).find(c => c.id === senderId);
    if (!sender) return;

    const absX = sender.bounds.x + x;
    const absY = sender.bounds.y + y;

    for (const target of connections.values()) {
        if (target.id === senderId) continue;

        const b = target.bounds;
        if (absX >= b.x && absX <= b.x + b.width &&
            absY >= b.y && absY <= b.y + b.height) {

            const relX = absX - b.x;
            const relY = absY - b.y;

            target.port.postMessage({
                type: 'spawn-particle',
                payload: { x: relX, y: relY, vx, vy }
            });
            return;
        }
    }
}
