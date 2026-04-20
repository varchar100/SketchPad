const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const colorPicker = document.getElementById('colorPicker');
const bgColorPicker = document.getElementById('bgColorPicker');
const brushSize = document.getElementById('brushSize');
const clearBtn = document.getElementById('clearBtn');
const saveBtn = document.getElementById('saveBtn');
const undoBtn = document.getElementById('undoBtn');
const collabModeBtn = document.getElementById('collabModeBtn');
const collabPanel = document.getElementById('collabPanel');

// PeerJS Variables
let peer = null;
let connections = [];
let isHost = false;
const BOARD_PREFIX = 'vboard-';

let isDrawing = false;
let isPanning = false;
let isPanningDrag = false;
let lastX = 0;
let lastY = 0;

let scale = 1;
let offsetX = 0;
let offsetY = 0;

let strokes = []; // { color, size, points: [{x, y}] }
let currentStroke = null;

function getTransformedPoint(x, y) {
    return {
        x: (x - offsetX) / scale,
        y: (y - offsetY) / scale
    };
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    render();
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function render() {
    // Clear and fill background
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = bgColorPicker.value;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Apply world transformation
    ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);

    // Draw all completed strokes
    [...strokes, currentStroke].filter(s => s).forEach(stroke => {
        if (stroke.points.length < 1) return;
        
        ctx.beginPath();
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        const pts = stroke.points;
        ctx.moveTo(pts[0].x, pts[0].y);
        
        for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.stroke();
    });

    updateStatus();
    updateUndoButton();
}

let activePointers = new Map();
let lastPinchDist = 0;
let lastPinchMid = { x: 0, y: 0 };

function updateStatus() {
    const status = document.querySelector('.status');
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouch) {
        status.textContent = `Zoom: ${Math.round(scale * 100)}% | Pinch/Two-finger Pan | Tap to Draw`;
    } else {
        status.textContent = `Zoom: ${Math.round(scale * 100)}% | Space+Drag to Pan | Scroll to Zoom`;
    }
}

function updateUndoButton() {
    undoBtn.disabled = strokes.length === 0;
}

// Drawing events
canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    activePointers.set(e.pointerId, e);

    if (activePointers.size === 1) {
        if ((e.pointerType === 'mouse' ? e.button === 0 : true) && !isPanning) {
            isDrawing = true;
            const pt = getTransformedPoint(e.clientX, e.clientY);
            currentStroke = {
                color: colorPicker.value,
                size: brushSize.value / scale, 
                points: [pt]
            };
        } else if (isPanning || (e.pointerType === 'mouse' && e.button === 1)) {
            isPanningDrag = true;
            [lastX, lastY] = [e.clientX, e.clientY];
        }
    } else if (activePointers.size === 2) {
        if (isDrawing) {
            isDrawing = false;
            currentStroke = null;
        }
        isPanningDrag = false;
        
        const pts = Array.from(activePointers.values());
        lastPinchDist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
        lastPinchMid = {
            x: (pts[0].clientX + pts[1].clientX) / 2,
            y: (pts[0].clientY + pts[1].clientY) / 2
        };
    }
});

window.addEventListener('pointermove', (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, e);

    if (activePointers.size === 1) {
        if (isDrawing && currentStroke) {
            const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
            for (let event of events) {
                const pt = getTransformedPoint(event.clientX, event.clientY);
                currentStroke.points.push(pt);
            }
            render();
        } else if (isPanningDrag) {
            const dx = e.clientX - lastX;
            const dy = e.clientY - lastY;
            offsetX += dx;
            offsetY += dy;
            [lastX, lastY] = [e.clientX, e.clientY];
            render();
        }
    } else if (activePointers.size === 2) {
        const pts = Array.from(activePointers.values());
        const dist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
        const midX = (pts[0].clientX + pts[1].clientX) / 2;
        const midY = (pts[0].clientY + pts[1].clientY) / 2;

        const zoomFactor = dist / lastPinchDist;
        const oldScale = scale;
        scale *= zoomFactor;
        scale = Math.max(0.05, Math.min(scale, 20));
        
        const actualFactor = scale / oldScale;
        
        offsetX = midX - (midX - offsetX) * actualFactor + (midX - lastPinchMid.x);
        offsetY = midY - (midY - offsetY) * actualFactor + (midY - lastPinchMid.y);

        lastPinchDist = dist;
        lastPinchMid = { x: midX, y: midY };
        render();
    }
});

const handlePointerUp = (e) => {
    activePointers.delete(e.pointerId);
    
    if (activePointers.size === 0) {
        if (isDrawing && currentStroke) {
            strokes.push(currentStroke);
            broadcast({ type: 'STROKE', data: currentStroke });
            currentStroke = null;
            isDrawing = false;
            render();
        }
        isPanningDrag = false;
    } else if (activePointers.size === 1) {
        const remainingPointer = activePointers.values().next().value;
        [lastX, lastY] = [remainingPointer.clientX, remainingPointer.clientY];
        lastPinchDist = 0;
    }
};

window.addEventListener('pointerup', handlePointerUp);
window.addEventListener('pointercancel', handlePointerUp);

// Zoom logic
function handleZoom(delta, centerX, centerY) {
    const zoomSpeed = 0.1;
    const oldScale = scale;
    if (delta > 0) scale *= (1 + zoomSpeed);
    else scale /= (1 + zoomSpeed);

    scale = Math.max(0.05, Math.min(scale, 20));

    const ratio = scale / oldScale;
    offsetX = centerX - (centerX - offsetX) * ratio;
    offsetY = centerY - (centerY - offsetY) * ratio;

    render();
}

canvas.addEventListener('wheel', (e) => {
    handleZoom(-e.deltaY, e.clientX, e.clientY);
    e.preventDefault();
}, { passive: false });

// Controls
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        isPanning = true;
        canvas.style.cursor = 'grab';
        e.preventDefault();
    }
    if (e.ctrlKey) {
        if (e.code === 'ArrowUp') {
            handleZoom(1, window.innerWidth / 2, window.innerHeight / 2);
            e.preventDefault();
        } else if (e.code === 'ArrowDown') {
            handleZoom(-1, window.innerWidth / 2, window.innerHeight / 2);
            e.preventDefault();
        }
    }
});

window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
        isPanning = false;
        canvas.style.cursor = 'crosshair';
    }
});

// Utils
undoBtn.addEventListener('click', () => {
    strokes.pop();
    broadcast({ type: 'UNDO' });
    render();
});

clearBtn.addEventListener('click', () => {
    if (confirm('Clear everything?')) {
        strokes = [];
        broadcast({ type: 'CLEAR' });
        render();
    }
});

bgColorPicker.addEventListener('input', () => {
    render();
    broadcast({ type: 'BG_COLOR', data: bgColorPicker.value });
});

saveBtn.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = `pizza-board-${Date.now()}.png`;
    link.href = canvas.toDataURL();
    link.click();
});

const fullscreenBtn = document.getElementById('fullscreenBtn');
const fullscreenText = fullscreenBtn.querySelector('.btn-text');

fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
        fullscreenText.textContent = 'Exit Full';
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
            fullscreenText.textContent = 'Fullscreen';
        }
    }
});

document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
        fullscreenText.textContent = 'Exit Full';
    } else {
        fullscreenText.textContent = 'Fullscreen';
    }
});

// TOGETHER MODE LOGIC
collabModeBtn.addEventListener('click', () => {
    collabPanel.classList.toggle('hidden');
});

document.getElementById('hostBtn').addEventListener('click', () => {
    initPeer();
});

document.getElementById('joinBtn').addEventListener('click', () => {
    const id = document.getElementById('joinIdInput').value.trim();
    if (id) {
        initPeer(BOARD_PREFIX + id);
    }
});

function initPeer(targetId = null) {
    const myId = targetId ? null : BOARD_PREFIX + Math.floor(1000 + Math.random() * 9000);
    
    if (peer) peer.destroy();
    peer = new Peer(myId);
    
    peer.on('open', (id) => {
        document.getElementById('setupMode').classList.add('hidden');
        document.getElementById('activeMode').classList.remove('hidden');
        
        const displayId = (targetId || id).replace(BOARD_PREFIX, '');
        document.getElementById('peerIdDisplay').textContent = displayId;
        
        if (targetId) {
            const conn = peer.connect(targetId);
            setupConnection(conn);
        } else {
            isHost = true;
        }
    });

    peer.on('error', (err) => {
        if (err.type === 'unavailable-id' && !targetId) {
            initPeer();
        } else if (err.type === 'peer-not-found') {
            alert('Board not found. Please check the ID.');
            location.reload();
        } else {
            console.error('PeerJS Error:', err.type);
        }
    });

    peer.on('connection', (conn) => {
        setupConnection(conn);
        if (isHost) {
            setTimeout(() => {
                conn.send({ 
                    type: 'INIT_STATE', 
                    data: { strokes, bgColor: bgColorPicker.value } 
                });
            }, 500);
        }
    });
}

function setupConnection(conn) {
    conn.on('open', () => {
        connections.push(conn);
        document.getElementById('connectionStatus').textContent = `● Live (${connections.length})`;
    });

    conn.on('data', (msg) => {
        handleRemoteData(msg);
        if (isHost) {
            connections.forEach(c => {
                if (c !== conn) c.send(msg);
            });
        }
    });

    conn.on('close', () => {
        connections = connections.filter(c => c !== conn);
        document.getElementById('connectionStatus').textContent = connections.length > 0 ? `● Live (${connections.length})` : '● Waiting...';
    });
}

function handleRemoteData(msg) {
    switch (msg.type) {
        case 'INIT_STATE':
            strokes = msg.data.strokes;
            bgColorPicker.value = msg.data.bgColor;
            render();
            break;
        case 'STROKE':
            strokes.push(msg.data);
            render();
            break;
        case 'UNDO':
            strokes.pop();
            render();
            break;
        case 'CLEAR':
            strokes = [];
            render();
            break;
        case 'BG_COLOR':
            bgColorPicker.value = msg.data;
            render();
            break;
    }
}

function broadcast(msg) {
    if (connections.length > 0) {
        connections.forEach(conn => conn.send(msg));
    }
}

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW registration failed:', err));
    });
}

canvas.addEventListener('contextmenu', e => e.preventDefault());

// Initial render
render();
