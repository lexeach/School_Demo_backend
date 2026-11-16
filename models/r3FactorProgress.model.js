const mongoose = require("mongoose");

const r3FactorProgressSchema = new mongoose.Schema({
  paper: { type: mongoose.Schema.Types.ObjectId, ref: "Paper", required: true },
  questionIndex: { type: Number, required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  factorId: { type: String, required: true },
  score: { type: Number, default: 0 },
  totalQuestions: { type: Number, default: 3 },
  status: { type: String, enum: ["Pending", "Completed"], default: "Pending" },
  attempts: { type: Number, default: 0 },
  lastAttemptAt: { type: Date, default: null },
}, { timestamps: true });

r3FactorProgressSchema.index({ paper: 1, questionIndex: 1, user: 1, factorId: 1 }, { unique: true });
module.exports = mongoose.model("R3FactorProgress", r3FactorProgressSchema);
