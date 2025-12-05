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

// Admin middleware (for simplicity, you can replace with proper role check)
function adminMiddleware(req,res,next){
const adminEmails = [process.env.ADMIN_EMAIL]; // single admin email
if(!adminEmails.includes(req.user.email)) return res.status(403).json({ message:'Admin access only' });
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
// Admin Routes
// --------------------------

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

// --------------------------
// Start server
// --------------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, ()=> console.log("Server running on port ${PORT}"));