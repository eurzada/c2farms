import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';

export function setupSocketHandlers(io) {
  // Authenticate socket connections via JWT
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id} (user: ${socket.userId})`);

    socket.on('join-farm', async (farmId) => {
      // Verify user has access to this farm
      try {
        const role = await prisma.userFarmRole.findUnique({
          where: { user_id_farm_id: { user_id: socket.userId, farm_id: farmId } },
        });
        if (!role) {
          socket.emit('error', { message: 'Access denied to this farm' });
          return;
        }
        socket.join(`farm:${farmId}`);
      } catch {
        socket.emit('error', { message: 'Failed to verify farm access' });
      }
    });

    socket.on('leave-farm', (farmId) => {
      socket.leave(`farm:${farmId}`);
    });

    // AI event subscription
    socket.on('join-farm-ai', async (farmId) => {
      try {
        const role = await prisma.userFarmRole.findUnique({
          where: { user_id_farm_id: { user_id: socket.userId, farm_id: farmId } },
        });
        if (!role) {
          socket.emit('error', { message: 'Access denied to this farm' });
          return;
        }
        socket.join(`farm-ai:${farmId}`);
      } catch {
        socket.emit('error', { message: 'Failed to join AI events' });
      }
    });

    socket.on('leave-farm-ai', (farmId) => {
      socket.leave(`farm-ai:${farmId}`);
    });

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  });
}

export function broadcastCellChange(io, farmId, data) {
  io.to(`farm:${farmId}`).emit('cell-changed', data);
}
