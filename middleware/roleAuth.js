const jwt = require('jsonwebtoken');
const User = require('../models/user');  // Import User model

// Middleware to check if the user has the required role
const roleAuth = (requiredRole) => {
  return async (req, res, next) => {
    try {
      // Check if the Authorization header is present
      const token = req.header('Authorization') && req.header('Authorization').replace('Bearer ', '');
      if (!token) {
        return res.status(400).send({ message: 'Authorization token missing' });
      }

      // Verify the token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Find the user based on the decoded user ID
      const user = await User.findById(decoded.userId);

      // Check if the user exists
      if (!user) {
        return res.status(404).send({ message: 'User not found' });
      }

      // Check if the user has the required role
      if (user.role !== requiredRole) {
        return res.status(403).send({ message: 'Forbidden: Insufficient role' });
      }

      // Attach user info to the request object for use in the next middleware/route handler
      req.user = user;

      // Proceed to the next middleware/route handler
      next();
    } catch (error) {
      // Handle specific JWT errors (expired token, invalid signature)
      if (error.name === 'TokenExpiredError') {
        return res.status(401).send({ message: 'Token has expired' });
      }
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).send({ message: 'Invalid token' });
      }

      // General error handler for other types of errors
      res.status(401).send({ message: 'Authentication failed', error: error.message });
    }
  };
};

module.exports = roleAuth;
