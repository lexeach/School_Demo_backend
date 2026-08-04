const express = require("express");

const router = express.Router();

const {
  registerUser,
  loginUser,
  getProfile,
  updateProfile,
} = require("../controllers/user.controller");

const { protect } = require("../middleware/auth");

/**
 * Public Routes
 */

// Register
router.post("/register", registerUser);

// Login
router.post("/login", loginUser);

/**
 * Protected Routes
 */

// Get Logged-in User
router.get("/profile", protect, getProfile);

// Update Profile
router.put("/profile", protect, updateProfile);

module.exports = router;