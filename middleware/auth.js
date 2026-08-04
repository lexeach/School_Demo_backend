const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");
const User = require("../models/user.model");

/**
 * Protect Routes
 * Verify JWT Token
 */
const protect = asyncHandler(async (req, res, next) => {
  let token;

  // Check Authorization Header
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer ")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];

      // Verify Token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Get Logged-in User
      req.user = await User.findById(decoded.id).select("-password");

      if (!req.user) {
        res.status(401);
        throw new Error("User not found.");
      }

      if (!req.user.isActive) {
        res.status(403);
        throw new Error("Your account has been disabled.");
      }

      next();
    } catch (error) {
      console.error("JWT Error:", error.message);

      res.status(401);

      if (error.name === "TokenExpiredError") {
        throw new Error("Session expired. Please login again.");
      }

      if (error.name === "JsonWebTokenError") {
        throw new Error("Invalid authentication token.");
      }

      throw new Error("Authentication failed.");
    }
  }

  if (!token) {
    res.status(401);
    throw new Error("No authentication token provided.");
  }
});

/**
 * Role-Based Authorization
 * Example: authorize("admin")
 * Example: authorize("admin", "parent")
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      res.status(403);
      throw new Error("You are not authorized to access this resource.");
    }

    next();
  };
};

module.exports = {
  protect,
  authorize,
};