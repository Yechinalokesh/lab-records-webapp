const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Define the schema for a user
const userSchema = new mongoose.Schema({
  rollNumber: { 
    type: String, 
    required: true, 
    unique: true 
  },  // User's roll number
  password: { 
    type: String, 
    required: true 
  },  // User's password (hashed)
  email: { 
    type: String, 
    required: true, 
    unique: true,
    match: [/.+\@.+\..+/, 'Please fill a valid email address']  // Email validation regex
  },  // User's email address
  role: { 
    type: String, 
    required: true 
  },  // User's role ('student', 'faculty', etc.)
  documents: [String],  // Array to store uploaded document file paths
});

// Password hashing middleware
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();  // Only hash if password is modified

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// Create a method to compare the password during login
userSchema.methods.comparePassword = function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Create a model based on the schema
const User = mongoose.model('User', userSchema);

// Export the model to use it in other files
module.exports = User;
