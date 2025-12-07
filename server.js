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

// Cloudinary config
cloudinary.config({
cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
api_key: process.env.CLOUDINARY_API_KEY,
api_secret: process.env.CLOUDINARY_API_SECRET
});

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
useNewUrlParser: true,
useUnifiedTopology: true
}).then(()=> console.log('MongoDB connected'))
.catch(err=> { console.error(err); process.exit(1); });

// Multer (memory)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// --------------------------
// Admin schema & model
// --------------------------
const adminSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName:  { type: String, required: true },
  email:     { type: String, required: true, unique: true },
  password:  { type: String, required: true }, // plain text for now
  createdAt: { type: Date, default: Date.now }
});

const Admin = mongoose.model('Admin', adminSchema);

// User Schema
const userSchema = new mongoose.Schema({
firstName: { type: String, required: true },
lastName:  { type: String, required: true },
email:     { type: String, required: true, unique: true },
phone:     { type: String, required: true },
dob:       { type: String, required: true },

street: String, city: String, state: String, zip: String,
password: { type: String, required: true }, // plain text for now
idFrontUrl: String, idBackUrl: String, selfieUrl: String,

verified: { type: Boolean, default: false },
frozen:   { type: Boolean, default: false },

balance:  { type: Number, default: 0 },
totalDeposit: { type: Number, default: 0 },
totalWithdrawal: { type: Number, default: 0 },
totalInvestment: { type: Number, default: 0 },

minDeposit: { type: Number, default: 0 },
minWithdrawal: { type: Number, default: 0 },

transactions: [{
type: { type: String, enum: ["deposit","investment","withdrawal"] },
amount: Number,
date: { type: Date, default: Date.now }
}],

createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model("User", userSchema);

// --------------------------
// Auth Middleware
// --------------------------
function authMiddleware(req,res,next){
const authHeader = req.headers.authorization;
if(!authHeader) return res.status(401).json({ message:'Missing authorization header' });
const token = authHeader.split(' ')[1];
if(!token) return res.status(401).json({ message:'Invalid token format' });
try {
const decoded = jwt.verify(token, process.env.JWT_SECRET || 'CHANGE_THIS_SECRET');
req.user = decoded;
next();
} catch(e){ return res.status(401).json({ message:'Invalid/expired token' }); }
}

// Admin middleware

function adminMiddleware(req, res, next) {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
  if (req.user.role !== 'admin')
    return res.status(403).json({ message: 'Admin access only' });
  next();
}

// --------------------------
// Helper: Cloudinary upload
// --------------------------
function uploadBufferToCloudinary(buffer, filename, folder='ann_investments/ids'){
return new Promise((resolve,reject)=>{
const uploadStream = cloudinary.uploader.upload_stream(
{ folder, public_id: filename, resource_type: 'image' },
(err,result)=> { if(err) reject(err); else resolve(result); }
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

// --------------------------
// Universal Login
// --------------------------
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: 'Missing email or password' });

    // Try User first
    let user = await User.findOne({ email });
    if (user && user.password === password) {
      const token = jwt.sign(
        { id: user._id, email: user.email, role: 'user' },
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
          verified: user.verified,
          balance: user.balance || 0,
          totalDeposit: user.totalDeposit || 0,
          totalInvestment: user.totalInvestment || 0,
          totalWithdrawal: user.totalWithdrawal || 0,
          transactions: user.transactions || [],
          role: 'user'
        }
      });
    }

    // Try Admin if not found in User
    const admin = await Admin.findOne({ email });
    if (admin && admin.password === password) {
      const token = jwt.sign(
        { id: admin._id, email: admin.email, role: 'admin' },
        process.env.JWT_SECRET || 'CHANGE_THIS_SECRET',
        { expiresIn: '3d' }
      );

      return res.json({
        message: 'Login successful',
        token,
        user: {
          id: admin._id,
          firstName: admin.firstName,
          lastName: admin.lastName,
          email: admin.email,
          role: 'admin'
        }
      });
    }

    return res.status(400).json({ message: 'Invalid email or password' });

  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Login failed' });
  }
});

// GET USER DETAILS 
app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });

    res.json({
      user: {
        firstName: user.firstName,
        lastName: user.lastName,
        dob: user.dob,
        phone: user.phone,
        email: user.email,
        street: user.street || '',
        city: user.city || '',
        state: user.state || '',
        zip: user.zip || '',
        selfieUrl: user.selfieUrl || '',
        verified: user.verified, // <-- add this
        balance: user.balance,
        totalDeposit: user.totalDeposit,
        totalInvestment: user.totalInvestment,
        totalWithdrawal: user.totalWithdrawal,
        transactions: user.transactions || [],
        minDeposit: user.minDeposit,
        minWithdrawal: user.minWithdrawal
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch user info' });
  }
});


// --------------------------
// Admin Routes
// --------------------------


// --------------------------
// Create Admin
// --------------------------
app.post('/api/admin/create', async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;
    if (!firstName || !lastName || !email || !password)
      return res.status(400).json({ message: 'All fields are required' });

    const existing = await Admin.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Email already registered' });

    const admin = new Admin({ firstName, lastName, email, password });
    await admin.save();

    return res.json({ message: 'Admin registered successfully', adminId: admin._id });
  } catch (err) {
    console.error('Admin creation error:', err);
    if (err.code === 11000) return res.status(400).json({ message: 'Email already registered' });
    return res.status(500).json({ message: 'Failed to create admin', error: err.message });
  }
});

// Get all users
app.get('/api/admin/users', authMiddleware, adminMiddleware, async(req,res)=>{
try {
const users = await User.find().select('-password');
res.json({ users });
} catch(e){ res.status(500).json({ message:'Failed to fetch users', error:e.message }); }
});

// Get single user
app.get('/api/admin/user/:id', authMiddleware, adminMiddleware, async(req,res)=>{
try{
const user = await User.findById(req.params.id).select('-password');
if(!user) return res.status(404).json({ message:'User not found' });
res.json({ user });
} catch(e){ res.status(500).json({ message:'Failed to fetch user', error:e.message }); }
});

// Update user info
app.put('/api/admin/user/:id', authMiddleware, adminMiddleware, async(req,res)=>{
try{
const updates = req.body; // { firstName, lastName, phone, balance... }
const user = await User.findByIdAndUpdate(req.params.id, updates, { new:true }).select('-password');
if(!user) return res.status(404).json({ message:'User not found' });
res.json({ message:'User updated', user });
} catch(e){ res.status(500).json({ message:'Failed to update user', error:e.message }); }
});

// --------------------------
// Verify User (Admin Only)
// --------------------------
app.patch('/api/users/:id/verify', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const userId = req.params.id;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.verified = true;
    await user.save();

    return res.json({ message: 'User verified successfully', user });
  } catch (err) {
    console.error('Verify user error:', err);
    return res.status(500).json({ message: 'Failed to verify user' });
  }
});

// Freeze / unfreeze
app.patch('/api/admin/user/:id/freeze', authMiddleware, adminMiddleware, async(req,res)=>{
try{
const user = await User.findById(req.params.id);
if(!user) return res.status(404).json({ message:'User not found' });
user.frozen = !user.frozen;
await user.save();
res.json({ message:"User ${user.frozen?'frozen':'unfrozen'}", user });
} catch(e){ res.status(500).json({ message:'Failed to toggle freeze', error:e.message }); }
});

// Update transactions
app.post('/api/admin/user/:id/transactions', authMiddleware, adminMiddleware, async(req,res)=>{
try{
const { type, amount } = req.body; // deposit, withdrawal, investment
const user = await User.findById(req.params.id);
if(!user) return res.status(404).json({ message:'User not found' });

// Update transactions
user.transactions.push({ type, amount, date: new Date() });

// Update totals & balance
if(type==='deposit'){ user.totalDeposit += amount; user.balance += amount; }
if(type==='withdrawal'){ user.totalWithdrawal += amount; user.balance -= amount; }
if(type==='investment'){ user.totalInvestment += amount; user.balance -= amount; }

await user.save();
res.json({ message:'Transaction added', user });

} catch(e){ res.status(500).json({ message:'Failed to add transaction', error:e.message }); }
});

// Delete user
app.delete('/api/admin/user/:id', authMiddleware, adminMiddleware, async(req,res)=>{
try{
const user = await User.findByIdAndDelete(req.params.id);
if(!user) return res.status(404).json({ message:'User not found' });
res.json({ message:'User deleted' });
} catch(e){ res.status(500).json({ message:'Failed to delete user', error:e.message }); }
});

// ==========================================
// UPDATE PROFILE (User Only)
// ==========================================
app.put("/api/update-profile", authMiddleware, async (req, res) => {
  try {
    const allowedFields = [
      "firstName",
      "lastName",
      "dob",
      "phone",
      "email",
      "street",
      "city",
      "state",
      "zip",
      "selfie"   // <-- IMPORTANT: allow selfie updates
    ];

    const updates = {};

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined && req.body[field] !== "") {
        updates[field] = req.body[field];
      }
    });

    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updates },
      { new: true }
    ).select("-password");

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({
      message: "Profile updated successfully",
      user: updatedUser
    });

  } catch (err) {
    console.error("Update profile error:", err);
    return res.status(500).json({ message: "Failed to update profile" });
  }
});

// --------------------------
// Start server
// --------------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, ()=> console.log("Server running on port ${PORT}"));