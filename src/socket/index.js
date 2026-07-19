const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const onlineUsers = new Map();

const setupSocket = (io) => {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const [users] = await pool.query('SELECT id FROM users WHERE id = ?', [decoded.userId]);
      if (users.length === 0) {
        return next(new Error('User not found'));
      }

      socket.userId = decoded.userId;
      next();
    } catch (error) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.userId}`);
    onlineUsers.set(socket.userId, socket.id);

    // Join user to their own room for private messages
    socket.join(`user:${socket.userId}`);

    // Update online status
    io.emit('user:online', { userId: socket.userId, online: true });

    // --- 1-on-1 Chat ---
    socket.on('chat:send', async (data) => {
      try {
        const { receiverId, content, imageUrl, locationLat, locationLng } = data;

        const [result] = await pool.query(
          `INSERT INTO messages (sender_id, receiver_id, content, image_url, location_lat, location_lng)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [socket.userId, receiverId, content || null, imageUrl || null, locationLat || null, locationLng || null]
        );

        const message = {
          id: result.insertId,
          sender_id: socket.userId,
          receiver_id: receiverId,
          content,
          image_url: imageUrl,
          location_lat: locationLat,
          location_lng: locationLng,
          created_at: new Date(),
          is_read: false
        };

        // Send to receiver's room
        io.to(`user:${receiverId}`).emit('chat:receive', message);

        // Send back to sender for confirmation
        socket.emit('chat:sent', message);

        // Notification
        await pool.query(
          'INSERT INTO notifications (user_id, title, body, type, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?)',
          [receiverId, 'New Message', content ? content.substring(0, 100) : 'Sent you an image/location', 'chat', 'user', socket.userId]
        );
      } catch (error) {
        console.error('Chat error:', error);
        socket.emit('chat:error', { error: 'Failed to send message' });
      }
    });

    // Mark as read
    socket.on('chat:read', async (data) => {
      try {
        const { senderId } = data;
        await pool.query(
          'UPDATE messages SET is_read = TRUE WHERE sender_id = ? AND receiver_id = ?',
          [senderId, socket.userId]
        );
        io.to(`user:${senderId}`).emit('chat:read_receipt', { userId: socket.userId });
      } catch (error) {
        console.error('Chat read error:', error);
      }
    });

    // Typing indicator
    socket.on('chat:typing', (data) => {
      const { receiverId, isTyping } = data;
      io.to(`user:${receiverId}`).emit('chat:typing', {
        userId: socket.userId,
        isTyping
      });
    });

    // --- Group Chat ---
    socket.on('group:send', async (data) => {
      try {
        const { groupId, content, imageUrl } = data;

        const [membership] = await pool.query(
          'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
          [groupId, socket.userId]
        );
        if (membership.length === 0) {
          return socket.emit('group:error', { error: 'Not a member of this group' });
        }

        const [result] = await pool.query(
          'INSERT INTO group_messages (group_id, sender_id, content, image_url) VALUES (?, ?, ?, ?)',
          [groupId, socket.userId, content || null, imageUrl || null]
        );

        const [user] = await pool.query(
          'SELECT name, photo_url FROM user_profiles WHERE user_id = ?',
          [socket.userId]
        );

        const message = {
          id: result.insertId,
          group_id: groupId,
          sender_id: socket.userId,
          sender_name: user[0]?.name,
          sender_photo: user[0]?.photo_url,
          content,
          image_url: imageUrl,
          created_at: new Date()
        };

        io.to(`group:${groupId}`).emit('group:receive', message);
      } catch (error) {
        console.error('Group chat error:', error);
        socket.emit('group:error', { error: 'Failed to send message' });
      }
    });

    // Join group room
    socket.on('group:join', async (data) => {
      try {
        const { groupId } = data;
        const [membership] = await pool.query(
          'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
          [groupId, socket.userId]
        );
        if (membership.length > 0) {
          socket.join(`group:${groupId}`);
          socket.emit('group:joined', { groupId });
        }
      } catch (error) {
        console.error('Group join error:', error);
      }
    });

    // Leave group room
    socket.on('group:leave', (data) => {
      const { groupId } = data;
      socket.leave(`group:${groupId}`);
    });

    // --- Event Chat ---
    socket.on('event:send', async (data) => {
      try {
        const { eventId, content, imageUrl } = data;

        const [registration] = await pool.query(
          'SELECT id FROM event_registrations WHERE event_id = ? AND user_id = ?',
          [eventId, socket.userId]
        );
        const [event] = await pool.query('SELECT user_id FROM events WHERE id = ?', [eventId]);
        if (registration.length === 0 && (event.length === 0 || event[0].user_id !== socket.userId)) {
          return socket.emit('event:error', { error: 'Not registered for this event' });
        }

        const [result] = await pool.query(
          'INSERT INTO event_discussions (event_id, user_id, content, image_url) VALUES (?, ?, ?, ?)',
          [eventId, socket.userId, content || null, imageUrl || null]
        );

        const [user] = await pool.query(
          'SELECT name, photo_url FROM user_profiles WHERE user_id = ?',
          [socket.userId]
        );

        const message = {
          id: result.insertId,
          event_id: eventId,
          user_id: socket.userId,
          sender_name: user[0]?.name,
          sender_photo: user[0]?.photo_url,
          content,
          image_url: imageUrl,
          created_at: new Date()
        };

        io.to(`event:${eventId}`).emit('event:receive', message);
      } catch (error) {
        console.error('Event chat error:', error);
        socket.emit('event:error', { error: 'Failed to send message' });
      }
    });

    // Join event room
    socket.on('event:join', async (data) => {
      try {
        const { eventId } = data;
        const [registration] = await pool.query(
          'SELECT id FROM event_registrations WHERE event_id = ? AND user_id = ?',
          [eventId, socket.userId]
        );
        const [event] = await pool.query('SELECT user_id FROM events WHERE id = ?', [eventId]);
        if (registration.length > 0 || (event.length > 0 && event[0].user_id === socket.userId)) {
          socket.join(`event:${eventId}`);
          socket.emit('event:joined', { eventId });
        }
      } catch (error) {
        console.error('Event join error:', error);
      }
    });

    // Leave event room
    socket.on('event:leave', (data) => {
      const { eventId } = data;
      socket.leave(`event:${eventId}`);
    });

    // --- Live Location Tracking ---
    socket.on('location:update', (data) => {
      const { requestId, latitude, longitude, heading, speed } = data;
      // Broadcast to the request owner's room
      socket.to(`request:${requestId}`).emit('location:helper', {
        userId: socket.userId,
        latitude,
        longitude,
        heading: heading || 0,
        speed: speed || 0,
        timestamp: Date.now(),
      });
    });

    // Join request tracking room (for request owner to receive helper location)
    socket.on('location:track', (data) => {
      const { requestId } = data;
      socket.join(`request:${requestId}`);
    });

    // Leave request tracking room
    socket.on('location:stop-tracking', (data) => {
      const { requestId } = data;
      socket.leave(`request:${requestId}`);
    });

    // 5 minutes away notification
    socket.on('location:5min-away', async (data) => {
      const { requestId } = data;
      socket.to(`request:${requestId}`).emit('location:5min-away', {
        userId: socket.userId,
        timestamp: Date.now(),
      });

      // DB notification for requester
      try {
        const [requests] = await pool.query('SELECT user_id FROM help_requests WHERE id = ?', [requestId]);
        if (requests.length > 0) {
          const [profile] = await pool.query('SELECT name FROM user_profiles WHERE user_id = ?', [socket.userId]);
          const name = profile[0]?.name || 'Worker';
          await pool.query(
            'INSERT INTO notifications (user_id, title, body, type, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?)',
            [requests[0].user_id, 'Worker is 5 Minutes Away', `${name} is almost there!`, 'task', 'help_request', requestId]
          );
        }
      } catch (_) {}
    });

    // Arrival notification
    socket.on('location:arrived', (data) => {
      const { requestId } = data;
      socket.to(`request:${requestId}`).emit('location:arrived', {
        userId: socket.userId,
        timestamp: Date.now(),
      });
    });

    // Work started notification
    socket.on('location:work-started', (data) => {
      const { requestId } = data;
      socket.to(`request:${requestId}`).emit('location:work-started', {
        userId: socket.userId,
        timestamp: Date.now(),
      });
    });

    // Disconnect
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.userId}`);
      onlineUsers.delete(socket.userId);
      io.emit('user:offline', { userId: socket.userId });
    });
  });

  return io;
};

module.exports = setupSocket;
