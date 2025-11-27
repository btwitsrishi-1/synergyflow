const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

// --- Advanced Window Management ---
const windows = new Map(); // id -> { window, bounds }

function registerWindow(win) {
  const id = win.id;
  windows.set(id, { window: win, bounds: win.getBounds() });

  win.on('move', () => {
    if (windows.has(id)) {
      windows.get(id).bounds = win.getBounds();
    }
  });

  win.on('resize', () => {
    if (windows.has(id)) {
      windows.get(id).bounds = win.getBounds();
    }
  });

  win.on('closed', () => {
    windows.delete(id);
  });
}

function createWindow(queryParams = {}, posOverride = null) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  // Randomize initial position slightly if not specified, or center
  let x = Math.floor(Math.random() * (width - 800));
  let y = Math.floor(Math.random() * (height - 600));

  if (posOverride) {
    x = posOverride.x;
    y = posOverride.y;
  }

  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    x: x,
    y: y,
    frame: true,
    transparent: false,
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  registerWindow(mainWindow);

  // Construct URL with query params
  let fileUrl = `file://${path.join(__dirname, 'index.html')}`;
  const params = new URLSearchParams(queryParams);
  if (Object.keys(queryParams).length > 0) {
    fileUrl += `?${params.toString()}`;
  }

  mainWindow.loadURL(fileUrl);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('spawn-ball', (event, arg) => {
  const hue = Math.floor(Math.random() * 360);
  const speed = Math.random() * 2 + 1;
  const complexity = Math.floor(Math.random() * 5) + 1;
  createWindow({ hue, speed, complexity });
});

ipcMain.on('particle-exit', (event, { x, y, vx, vy, behavior, offset, hue }) => {
  const senderId = event.sender.id;
  const senderBounds = windows.get(senderId)?.bounds;
  if (!senderBounds) return;

  // Calculate absolute position of the particle
  const absX = senderBounds.x + x;
  const absY = senderBounds.y + y;

  // Find target window that contains this point (or is closest in direction)
  for (const [id, data] of windows) {
    if (id === senderId) continue;
    const b = data.bounds;
    // Check if particle is entering this window (with some margin)
    if (absX >= b.x && absX <= b.x + b.width &&
      absY >= b.y && absY <= b.y + b.height) {

      // Convert absolute back to relative for target window
      const relX = absX - b.x;
      const relY = absY - b.y;

      data.window.webContents.send('spawn-particle', { x: relX, y: relY, vx, vy, behavior, offset, hue });
      return; // Transferred
    }
  }
});

// --- 3ms State Loop ---
setInterval(() => {
  const windowList = Array.from(windows.values());

  windowList.forEach(source => {
    const sourceCenter = {
      x: source.bounds.x + source.bounds.width / 2,
      y: source.bounds.y + source.bounds.height / 2
    };

    let totalForceX = 0;
    let totalForceY = 0;
    const neighbors = [];

    windowList.forEach(target => {
      if (source.window.id === target.window.id) return;

      const targetCenter = {
        x: target.bounds.x + target.bounds.width / 2,
        y: target.bounds.y + target.bounds.height / 2
      };

      const dx = targetCenter.x - sourceCenter.x;
      const dy = targetCenter.y - sourceCenter.y;
      const distSq = dx * dx + dy * dy;
      const dist = Math.sqrt(distSq);

      // Gravity formula: F = G / distSq
      const safeDistSq = Math.max(distSq, 10000);
      const forceMagnitude = 500000 / safeDistSq;

      const fx = (dx / dist) * forceMagnitude;
      const fy = (dy / dist) * forceMagnitude;

      totalForceX += fx;
      totalForceY += fy;

      neighbors.push({
        id: target.window.id,
        dx,
        dy,
        dist
      });
    });

    if (!source.window.isDestroyed()) {
      source.window.webContents.send('update-state', {
        gravity: { x: totalForceX, y: totalForceY },
        neighbors
      });
    }
  });
}, 3);
