const express = require("express");
const router = express.Router();
const { auth } = require("../middleware/auth");
const controller = require("../controllers/r3Factor.controller");

router.post("/generate", auth, controller.getOrGenerate);
router.post("/verify", auth, controller.submitFactorVerification);
router.post("/expand", auth, controller.expandFactor);

module.exports = router;
