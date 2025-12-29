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
totalProfit: { type: Number, default: 0 },

minDeposit: { type: Number, default: 0 },
minWithdrawal: { type: Number, default: 0 },

transactions: [{
type: { type: String, enum: ["deposit","investment","withdrawal", "profit"] },
amount: Number,
date: { type: Date, default: Date.now }
}],

createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model("User", userSchema);

// ======= INVESTMENT SCHEMA =======
const investmentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  capital: { type: Number, required: true },
  term: { type: String, enum: ['short', 'medium', 'long'], required: true },
  profitPercentage: { type: Number, required: true }, // e.g., 0.2667%
  startDate: { type: Date, default: Date.now },
  status: { type: String, enum: ['active', 'paused', 'completed'], default: 'active' } // added 'paused'
});
const Investment = mongoose.model("Investment", investmentSchema);

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
app.post('/api/register', async (req, res) => {
  try {
    const {
      firstName, lastName, email, phone, dob,
      street = '', city = '', state = '', zip = '',
      password
    } = req.body;

    if (!firstName || !lastName || !email || !phone || !dob || !password) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const existing = await User.findOne({ email });
    if (existing)
      return res.status(400).json({ message: 'Email already registered' });

    const user = new User({
      firstName, lastName, email, phone, dob,
      street, city, state, zip,
      password,
      idFrontUrl: '',
      idBackUrl: '',
      selfieUrl: '',
      verified: false
    });

    await user.save();

    return res.json({
      message: 'Registration successful.',
      userId: user._id
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Registration failed' });
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
          totalProfit: user.totalProfit || 0,
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

// GET USER DETAILS WITH INVESTMENTS
app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Fetch user's investments
    const investments = await Investment.find({ user: user._id }).sort({ startDate: -1 });

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
        verified: user.verified,
        balance: user.balance,
        totalDeposit: user.totalDeposit,
        totalInvestment: user.totalInvestment,
        totalWithdrawal: user.totalWithdrawal,
        totalProfit: user.totalProfit,
        transactions: user.transactions || [],
        minDeposit: user.minDeposit,
        minWithdrawal: user.minWithdrawal,
        investments: investments.map(inv => ({
          _id: inv._id,
          capital: inv.capital,
          term: inv.term,
          profitPercentage: inv.profitPercentage,
          startDate: inv.startDate,
          status: inv.status
        }))
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

// Admin: Update deposit/withdrawal transactions
app.post('/api/admin/user/:id/transactions', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { type, amount } = req.body;  
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!['deposit', 'withdrawal', 'profit'].includes(type)) {
      return res.status(400).json({ message: 'Invalid transaction type for this route' });
    }

    // Log transaction
    user.transactions.push({ type, amount, date: new Date() });

    // Handle balances & totals
    if (type === 'deposit') {
      user.totalDeposit += amount;
      user.balance += amount;
    }

    if (type === 'withdrawal') {
      user.totalWithdrawal += amount;
      user.balance -= amount;
    }

    // Optional: Manual profit addition
    if (type === 'profit') {
      user.totalProfit += amount;
      user.balance += amount;
    }

    await user.save();
    res.json({ message: 'Transaction recorded', user });

  } catch (e) {
    res.status(500).json({ message: 'Failed to record transaction', error: e.message });
  }
});

// --------------------------
// Admin Investment Routes
// --------------------------

// CREATE INVESTMENT
app.post('/api/admin/investments/create', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId, capital, term, profitPercentage } = req.body;

    if (!userId || !capital || !term || !profitPercentage) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.balance < capital) {
      return res.status(400).json({ message: 'User balance insufficient for this investment' });
    }

    // Deduct capital from user's balance and update totalInvestment
    user.balance -= capital;
    user.totalInvestment += capital;

    // Add investment transaction
    user.transactions.push({ type: 'investment', amount: capital, date: new Date() });

    await user.save();

    // Save investment
    const investment = new Investment({
      user: userId,
      capital,
      term, // short, medium, long
      profitPercentage,
      startDate: new Date(),
      status: 'active'
    });

    await investment.save();

    res.json({ message: 'Investment created successfully', investment });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to create investment', error: err.message });
  }
});

// GET ALL INVESTMENTS (optionally filter by user)
app.get('/api/admin/investments', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.query;
    const query = userId ? { user: userId } : {};

    const investments = await Investment.find(query)
      .populate('user', 'firstName lastName email') // optional
      .sort({ startDate: -1 }); // latest first

    res.json({ investments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch investments', error: err.message });
  }
});

// COMPLETE INVESTMENT (mark as finished, add profit to user)
app.patch('/api/admin/investments/:id/complete', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const investment = await Investment.findById(req.params.id);
    if (!investment) return res.status(404).json({ message: 'Investment not found' });
    if (investment.status === 'completed') return res.status(400).json({ message: 'Investment already completed' });

    const user = await User.findById(investment.user);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Calculate profit
    const termDays = investment.term === 'short' ? 25 : investment.term === 'medium' ? 40 : 60;
    const dailyProfit = investment.capital * (investment.profitPercentage / 100);
    const totalProfit = dailyProfit * termDays;

    // Update user balance and totalProfit
    user.balance += totalProfit;
    user.totalProfit += totalProfit;

    // Add profit transaction
    user.transactions.push({ type: 'profit', amount: totalProfit, date: new Date() });

    await user.save();

    // Mark investment as completed
    investment.status = 'completed';
    await investment.save();

    res.json({ message: 'Investment completed and profit added', investment, totalProfit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to complete investment', error: err.message });
  }
});

// Admin: Update investment status (activate/deactivate)
app.patch('/api/admin/investments/:id/status', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'paused'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status. Only "active" or "paused" allowed.' });
    }

    const investment = await Investment.findById(req.params.id);
    if (!investment) return res.status(404).json({ message: 'Investment not found' });
    if (investment.status === 'completed') return res.status(400).json({ message: 'Cannot change a completed investment' });

    investment.status = status;
    await investment.save();

    res.json({ message: `Investment status updated to ${status}`, investment });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update investment status', error: err.message });
  }
});

// Admin: Get single investment
app.get('/api/admin/investments/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const investment = await Investment.findById(req.params.id).populate('user', 'firstName lastName email');
    if (!investment) return res.status(404).json({ message: 'Investment not found' });
    res.json({ investment });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch investment', error: err.message });
  }
});

// PATCH /api/admin/investments/:id/status
app.patch('/api/admin/investments/:id/status', authMiddleware, adminMiddleware, async (req,res)=>{
  try{
    const { status } = req.body; // expected 'active' or 'paused'
    const investment = await Investment.findById(req.params.id);
    if(!investment) return res.status(404).json({ message: 'Investment not found' });

    investment.status = status; 
    await investment.save();

    res.json({ message: `Investment ${status}`, investment });
  } catch(err){
    console.error(err);
    res.status(500).json({ message:'Failed to update status', error:err.message });
  }
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
app.put(
  "/api/update-profile",
  authMiddleware,
  upload.fields([
    { name: "selfie", maxCount: 1 },
    { name: "idFront", maxCount: 1 },
    { name: "idBack", maxCount: 1 }
  ]),
  async (req, res) => {
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
        "zip"
      ];

      const updates = {};

      // Regular fields
      allowedFields.forEach(field => {
        if (req.body[field] !== undefined && req.body[field] !== "") {
          updates[field] = req.body[field];
        }
      });

      // Uploaded files (selfie, idFront, idBack)
      const files = req.files || {};
      if (files.selfie && files.selfie[0]) {
        const result = await uploadBufferToCloudinary(files.selfie[0].buffer, `selfie_${Date.now()}`);
        updates.selfieUrl = result.secure_url;
      }
      if (files.idFront && files.idFront[0]) {
        const result = await uploadBufferToCloudinary(files.idFront[0].buffer, `idFront_${Date.now()}`);
        updates.idFrontUrl = result.secure_url;
      }
      if (files.idBack && files.idBack[0]) {
        const result = await uploadBufferToCloudinary(files.idBack[0].buffer, `idBack_${Date.now()}`);
        updates.idBackUrl = result.secure_url;
      }

      const updatedUser = await User.findByIdAndUpdate(
        req.user.id,
        { $set: updates },
        { new: true }
      ).select("-password");

      if (!updatedUser) return res.status(404).json({ message: "User not found" });

      return res.json({
        message: "Profile updated successfully",
        user: updatedUser
      });
    } catch (err) {
      console.error("Update profile error:", err);
      return res.status(500).json({ message: "Failed to update profile" });
    }
  }
);

// --------------------------
// Start server
// --------------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, ()=> console.log("Server running on port ${PORT}"));