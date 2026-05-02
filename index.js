const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { Expo } = require('expo-server-sdk');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || '/data/data.json';

const expo = new Expo();

app.use(cors());
app.use(express.json());

// Initialize database
async function initDB() {
  try {
    await fs.access(DB_PATH);
  } catch {
    const initialData = {
      users: [],
      courtAvailability: [],
      monitoringEnabled: true,
      lastCheck: null
    };
    await fs.writeFile(DB_PATH, JSON.stringify(initialData, null, 2));
  }
}

async function readDB() {
  const data = await fs.readFile(DB_PATH, 'utf8');
  return JSON.parse(data);
}

async function writeDB(data) {
  await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
}

// Simulate tennis court availability check
async function checkJoeDiMaggioCourts() {
  console.log('Checking Joe DiMaggio tennis courts...');
  
  // Simulate API call to tennis court booking system
  const upcomingFridays = getUpcomingFridays();
  const availableSlots = [];
  
  // Simulate random availability (in real app, this would be an actual API call)
  upcomingFridays.forEach(friday => {
    const eveningSlots = ['5:00 PM', '6:00 PM', '7:00 PM', '8:00 PM'];
    eveningSlots.forEach(time => {
      if (Math.random() > 0.7) { // 30% chance of availability
        availableSlots.push({
          id: `${friday.toISOString().split('T')[0]}-${time}`,
          date: friday.toISOString().split('T')[0],
          time: time,
          court: `Court ${Math.floor(Math.random() * 4) + 1}`,
          available: true,
          discovered: new Date().toISOString()
        });
      }
    });
  });
  
  const db = await readDB();
  const previousSlots = db.courtAvailability || [];
  const newSlots = availableSlots.filter(slot => 
    !previousSlots.some(prev => prev.id === slot.id)
  );
  
  if (newSlots.length > 0) {
    console.log(`Found ${newSlots.length} new available slots`);
    await sendNotifications(newSlots);
  }
  
  db.courtAvailability = availableSlots;
  db.lastCheck = new Date().toISOString();
  await writeDB(db);
  
  return availableSlots;
}

function getUpcomingFridays(count = 4) {
  const fridays = [];
  const today = new Date();
  let current = new Date(today);
  
  // Find next Friday
  while (current.getDay() !== 5) {
    current.setDate(current.getDate() + 1);
  }
  
  // Get upcoming Fridays
  for (let i = 0; i < count; i++) {
    fridays.push(new Date(current));
    current.setDate(current.getDate() + 7);
  }
  
  return fridays;
}

async function sendNotifications(newSlots) {
  const db = await readDB();
  const users = db.users.filter(user => user.pushToken && user.notificationsEnabled);
  
  if (users.length === 0) return;
  
  const messages = [];
  
  for (const user of users) {
    if (!Expo.isExpoPushToken(user.pushToken)) {
      console.log(`Invalid push token: ${user.pushToken}`);
      continue;
    }
    
    for (const slot of newSlots) {
      messages.push({
        to: user.pushToken,
        sound: 'default',
        title: '🎾 Court Available!',
        body: `${slot.court} available on ${new Date(slot.date).toLocaleDateString()} at ${slot.time}`,
        data: { slot }
      });
    }
  }
  
  if (messages.length > 0) {
    const chunks = expo.chunkPushNotifications(messages);
    
    for (const chunk of chunks) {
      try {
        await expo.sendPushNotificationsAsync(chunk);
        console.log(`Sent ${chunk.length} notifications`);
      } catch (error) {
        console.error('Error sending notifications:', error);
      }
    }
  }
}

// API Routes
app.get('/', (req, res) => {
  console.log(`${req.method} ${req.url}`);
  res.json({ 
    status: 'ok', 
    service: 'Tennis Court Monitor',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/courts', async (req, res) => {
  console.log(`${req.method} ${req.url}`);
  try {
    const db = await readDB();
    res.json({
      courts: db.courtAvailability || [],
      lastCheck: db.lastCheck,
      monitoringEnabled: db.monitoringEnabled
    });
  } catch (error) {
    console.error('Error fetching courts:', error);
    res.status(500).json({ error: 'Failed to fetch court data' });
  }
});

app.post('/api/register', async (req, res) => {
  console.log(`${req.method} ${req.url}`);
  try {
    const { pushToken, userId } = req.body;
    
    if (!pushToken) {
      return res.status(400).json({ error: 'Push token required' });
    }
    
    const db = await readDB();
    const existingUser = db.users.find(u => u.userId === userId);
    
    if (existingUser) {
      existingUser.pushToken = pushToken;
      existingUser.updatedAt = new Date().toISOString();
    } else {
      db.users.push({
        userId: userId || Date.now().toString(),
        pushToken,
        notificationsEnabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    
    await writeDB(db);
    res.json({ success: true, message: 'Registered for notifications' });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/check-now', async (req, res) => {
  console.log(`${req.method} ${req.url}`);
  try {
    const availableSlots = await checkJoeDiMaggioCourts();
    res.json({ 
      success: true, 
      slotsFound: availableSlots.length,
      slots: availableSlots
    });
  } catch (error) {
    console.error('Error checking courts:', error);
    res.status(500).json({ error: 'Failed to check courts' });
  }
});

app.post('/api/toggle-monitoring', async (req, res) => {
  console.log(`${req.method} ${req.url}`);
  try {
    const db = await readDB();
    db.monitoringEnabled = !db.monitoringEnabled;
    await writeDB(db);
    
    res.json({ 
      success: true, 
      monitoringEnabled: db.monitoringEnabled 
    });
  } catch (error) {
    console.error('Error toggling monitoring:', error);
    res.status(500).json({ error: 'Failed to toggle monitoring' });
  }
});

// Schedule court checking every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  try {
    const db = await readDB();
    if (db.monitoringEnabled) {
      await checkJoeDiMaggioCourts();
    }
  } catch (error) {
    console.error('Scheduled check error:', error);
  }
});

// Initialize and start server
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Tennis Court Monitor API running on port ${PORT}`);
    console.log('Court monitoring scheduled every 15 minutes');
  });
}).catch(console.error);