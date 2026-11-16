const mongoose = require("mongoose");

const r3QuestionSchema = new mongoose.Schema({
  question: { type: String, required: true },
  options: { type: [String], required: true },
  correctAnswer: { type: String, required: true },
}, { _id: false });

const factorSchema = new mongoose.Schema({
  factorId: { type: String, required: true },
  name: { type: String, required: true },
  description: { type: String, default: "" },
  parentFactorId: { type: String, default: null },
  depth: { type: Number, default: 1 },
  learningContent: { type: String, default: "" },
  verificationQuestions: { type: [r3QuestionSchema], default: [] },
  children: { type: [mongoose.Schema.Types.Mixed], default: [] },
  expanded: { type: Boolean, default: false },
}, { _id: false });

const r3FactorSchema = new mongoose.Schema({
  paper: { type: mongoose.Schema.Types.ObjectId, ref: "Paper", required: true },
  // Exact existing Paper.questions subdocument _id; never generate or rewrite it here.
  questionId: { type: String, required: true },
  questionIndex: { type: Number, required: true },
  originalQuestion: { type: mongoose.Schema.Types.Mixed, required: true },
  topic: { type: String, required: true },
  secondaryFactor: { type: String, required: true },
  factors: { type: [factorSchema], default: [] },
}, { timestamps: true });

r3FactorSchema.index({ paper: 1, questionId: 1 }, { unique: true, partialFilterExpression: { questionId: { $type: 'string' } } });
module.exports = mongoose.model("R3Factor", r3FactorSchema);
