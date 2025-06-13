const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const redis = require('redis');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const morgan = require('morgan');
const socketIo = require('socket.io');

// Set up the app and server
const app = express();
const http = require('http');
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: msg => logger.info(msg) } }));

// Set up winston for logging
const logger = winston.createLogger({
  level: 'info',
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'server.log' })
  ]
});

// Set up Redis client
const client = redis.createClient();
client.on('error', (err) => console.log('Redis error: ' + err));

// Set up MongoDB connection
mongoose.connect('mongodb://localhost:27017/labRecords', { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.log('MongoDB connection error: ' + err));

// Define schemas and models
const UserSchema = new mongoose.Schema({
  rollNumber: String,
  password: String,
  email: String,
  role: String,
  avatar: String
});

const LabRecordSchema = new mongoose.Schema({
  title: String,
  description: String,
  filePath: String,
  createdBy: mongoose.Schema.Types.ObjectId
});

const User = mongoose.model('User', UserSchema);
const LabRecord = mongoose.model('LabRecord', LabRecordSchema);

// Set up file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, './uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

// API Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per window
  message: 'Too many requests, please try again later.'
});
app.use(limiter);

// JWT Authentication Middleware
const roleAuth = (roles) => {
  return (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(403).send({ message: 'Access denied' });
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!roles.includes(decoded.role)) {
        return res.status(403).send({ message: 'Access denied' });
      }
      req.user = decoded;
      next();
    } catch (err) {
      res.status(400).send({ message: 'Invalid token' });
    }
  };
};

// Set up Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Routes

// Register route
app.post('/register', async (req, res) => {
  const { rollNumber, password, email, role } = req.body;
  try {
    const existingUser = await User.findOne({ rollNumber });
    if (existingUser) {
      return res.status(400).send({ message: 'Roll number already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ rollNumber, password: hashedPassword, email, role });
    await newUser.save();

    // Send welcome email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Welcome to the system!',
      text: `Hello ${rollNumber},\n\nWelcome to our platform. Your account has been successfully created.`
    };
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.log('Email error:', error);
      } else {
        console.log('Email sent: ' + info.response);
      }
    });

    res.status(201).send({ message: 'User registered successfully' });
  } catch (err) {
    res.status(500).send({ message: 'Error registering user', error: err });
  }
});

// Login route
app.post('/login', async (req, res) => {
  const { rollNumber, password } = req.body;
  try {
    const user = await User.findOne({ rollNumber });
    if (!user) {
      return res.status(404).send({ message: 'User not found' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).send({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.send({ message: 'Login successful', token });
  } catch (err) {
    res.status(500).send({ message: 'Error logging in', error: err });
  }
});

// Refresh Token route
app.post('/refresh-token', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).send({ message: 'Refresh token required' });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    const newAccessToken = jwt.sign({ userId: decoded.userId, role: decoded.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ newAccessToken });
  } catch (err) {
    res.status(400).send({ message: 'Invalid refresh token' });
  }
});

// Update Profile route (including avatar upload)
app.post('/update-profile', upload.single('avatar'), async (req, res) => {
  const { userId } = req.body;
  const filePath = req.file ? req.file.path : null;
  
  try {
    const user = await User.findByIdAndUpdate(userId, { avatar: filePath });
    res.send({ message: 'Profile updated successfully', user });
  } catch (err) {
    res.status(500).send({ message: 'Error updating profile', error: err });
  }
});

// Lab Record Route
app.post('/lab-records', roleAuth(['admin', 'teacher']), upload.single('labFile'), async (req, res) => {
  const { title, description, createdBy } = req.body;
  const filePath = req.file ? req.file.path : null;

  try {
    const newRecord = new LabRecord({ title, description, filePath, createdBy });
    await newRecord.save();
    res.status(201).send({ message: 'Lab record added successfully', record: newRecord });
  } catch (err) {
    res.status(500).send({ message: 'Error adding lab record', error: err });
  }
});

// Get all lab records (with Redis cache)
app.get('/records', async (req, res) => {
  const cacheKey = 'all_lab_records';
  client.get(cacheKey, async (err, cachedRecords) => {
    if (cachedRecords) {
      return res.json(JSON.parse(cachedRecords));
    }

    try {
      const records = await LabRecord.find();
      client.setex(cacheKey, 3600, JSON.stringify(records)); // Cache for 1 hour
      res.json(records);
    } catch (err) {
      res.status(500).send({ message: 'Error retrieving records' });
    }
  });
});

// Socket.io for real-time notifications
io.on('connection', (socket) => {
  console.log('A user connected');
  
  // Emit a message to the client
  socket.emit('message', 'Welcome to the real-time system!');
  
  // You can listen for events and emit back to clients
  socket.on('new_lab_record', (data) => {
    io.emit('new_lab_record', data); // Broadcast new lab record to all clients
  });
});

// Start the server
server.listen(5000, () => {
  console.log('Server is running on port 5000');
});  
