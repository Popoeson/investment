// server.js
// Ann Investment Company - single-file backend
// Node + Express + MongoDB + Cloudinary (direct backend upload)

const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const streamifier = require('streamifier');
const cloudinary = require('cloudinary').v2;
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// --------------------------
// Cloudinary config
// --------------------------
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// --------------------------
// MongoDB connection
// --------------------------
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected'))
.catch((err) => {
  console.error('MongoDB connection error:', err);
  process.exit(1);
});

// --------------------------
// Multer (memory storage)
// --------------------------
const storage = multer.memoryStorage();
const upload = multer({ storage });

// --------------------------
// User schema & model
// --------------------------
const userSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName:  { type: String, required: true },
  email:     { type: String, required: true, unique: true },
  phone:     { type: String, required: true },
  dob:       { type: String, required: true },

  street:    String,
  city:      String,
  state:     String,
  zip:       String,

  password:  { type: String, required: true }, // plain text per request (INSECURE)
  idFrontUrl:{ type: String },
  idBackUrl: { type: String },
  selfieUrl: { type: String },

  verified:  { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// --------------------------
// Helper: upload buffer to Cloudinary (returns url)
// --------------------------
function uploadBufferToCloudinary(buffer, filename, folder = 'ann_investments/ids') {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, public_id: filename, resource_type: 'image' },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
}

// --------------------------
// Routes
// --------------------------

// Health
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Registration
// Expects multipart/form-data with fields + files:
// files named: idFront, idBack, selfie
app.post('/api/register', upload.fields([
  { name: 'idFront', maxCount: 1 },
  { name: 'idBack', maxCount: 1 },
  { name: 'selfie', maxCount: 1 }
]), async (req, res) => {
  try {
    // Basic form fields
    const {
      firstName, lastName, email, phone, dob,
      street = '', city = '', state = '', zip = '',
      password
    } = req.body;

    if (!firstName || !lastName || !email || !phone || !dob || !password) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Check if already registered
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Email already registered' });

    // Upload files to Cloudinary (if present)
    const files = req.files || {};
    const uploads = {};

    if (files.idFront && files.idFront[0]) {
      const f = files.idFront[0];
      const name = `idFront_${Date.now()}`;
      const result = await uploadBufferToCloudinary(f.buffer, name);
      uploads.idFrontUrl = result.secure_url;
    } else {
      uploads.idFrontUrl = '';
    }

    if (files.idBack && files.idBack[0]) {
      const f = files.idBack[0];
      const name = `idBack_${Date.now()}`;
      const result = await uploadBufferToCloudinary(f.buffer, name);
      uploads.idBackUrl = result.secure_url;
    } else {
      uploads.idBackUrl = '';
    }

    if (files.selfie && files.selfie[0]) {
      const f = files.selfie[0];
      const name = `selfie_${Date.now()}`;
      const result = await uploadBufferToCloudinary(f.buffer, name);
      uploads.selfieUrl = result.secure_url;
    } else {
      uploads.selfieUrl = '';
    }

    // Create user (password stored as plain text per your instruction)
    const user = new User({
      firstName, lastName, email, phone, dob,
      street, city, state, zip,
      password,
      idFrontUrl: uploads.idFrontUrl,
      idBackUrl: uploads.idBackUrl,
      selfieUrl: uploads.selfieUrl,
      verified: false
    });

    await user.save();

    return res.json({
      message: 'Registration successful. Identity verification in progress.',
      userId: user._id
    });

  } catch (err) {
    console.error('Registration error:', err);
    // handle duplicate key error gracefully
    if (err.code === 11000 && err.keyPattern && err.keyPattern.email) {
      return res.status(400).json({ message: 'Email already registered' });
    }
    return res.status(500).json({ message: 'Registration failed', error: err.message });
  }
});

// Login (plain password)
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Missing email or password' });

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid email or password' });

    // Plain text compare (INSECURE; replace with bcrypt later)
    if (user.password !== password) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    // Issue JWT
    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET || 'CHANGE_THIS_SECRET',
      { expiresIn: '3d' }
    );

    return res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        verified: user.verified
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Login failed' });
  }
});

// Simple protected route example (requires token)
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: 'Missing authorization header' });
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Invalid token format' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'CHANGE_THIS_SECRET');
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

// Example: get current user info
app.get('/api/me', authMiddleware, async (req, res) => {
  const user = await User.findById(req.user.id).select('-password');
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json({ user });
});

// Admin: mark user verified (simple route - in production protect with admin auth)
app.post('/api/admin/verify/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findByIdAndUpdate(userId, { verified: true }, { new: true });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'User verified', userId: user._id });
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({ message: 'Verification failed' });
  }
});

// --------------------------
// Start server
// --------------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));