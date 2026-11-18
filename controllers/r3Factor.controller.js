const Paper = require("../models/paper.model");
const R3Factor = require("../models/r3Factor.model");
const R3FactorProgress = require("../models/r3FactorProgress.model");
const ai = require("../utils/ai/provider");
const { generateVerificationQuestions } = require("../utils/question.ai");
const { successResponse, errorResponse, customErrorResponse } = require("../utils/response.dto");


const authorizePaper = async (paper, userId) => {
  const ownsPaper =
    String(paper.author || "") === String(userId) ||
    String(paper.authorId || "") === String(userId) ||
    String(paper.childrenId || "") === String(userId);
  if (ownsPaper) return true;
  const Child = require("../models/child.model");
  const child = paper.children ? await Child.findById(paper.children) : null;
  return !!child && (
    String(child.owner || "") === String(userId) ||
    String(child.parent || "") === String(userId)
  );
};

// Paper.questions is stored as an array of plain objects ([Object]), not
// Mongoose subdocuments. In the current data those objects have questionNumber
// but no _id. The frontend therefore sends the existing questionNumber in the
// questionId API field. Resolve it within this paper; never create/alter IDs.
const resolveQuestion = (paper, questionKey) => {
  if (questionKey === undefined || questionKey === null || String(questionKey).trim() === "") return null;
  const supplied = String(questionKey).trim();

  // Backward compatibility for any older question objects that genuinely have _id.
  const byExistingId = (paper.questions || []).find(q => q?._id && String(q._id) === supplied);
  if (byExistingId) return byExistingId;

  const number = Number(supplied);
  if (!Number.isInteger(number) || number < 1) return null;
  return (paper.questions || []).find(q => Number(q?.questionNumber) === number);
};

const safeFactor = (factor, progressMap) => {
  const own = progressMap.get(factor.factorId);
  const children = (factor.children || []).map(child => safeFactor(child, progressMap));
  const ownVerified = own?.status === "Completed";
  // A factor is satisfied either by passing its own check (no decomposition),
  // or, after an explicit expansion, by verifying every generated child.
  const hasChildren = (factor.children || []).length > 0;
  const descendantsVerified = children.length > 0 && children.every(child => child.effectiveVerified);
  const effectiveVerified = hasChildren ? descendantsVerified : ownVerified;
  return {
    factorId: factor.factorId,
    name: factor.name,
    description: factor.description,
    parentFactorId: factor.parentFactorId,
    depth: factor.depth,
    learningContent: factor.learningContent,
    verificationQuestions: [],
    children,
    ownVerified,
    effectiveVerified,
    canExploreFurther: !effectiveVerified && !hasChildren && (own?.attempts || 0) > 0,
    attempts: own?.attempts || 0,
    score: own?.score ?? null,
    totalQuestions: own?.totalQuestions ?? 3
  };
};

const findFactor = (items, id) => {
  for (const item of items || []) {
    if (item.factorId === id) return item;
    const found = findFactor(item.children, id);
    if (found) return found;
  }
  return null;
};

const makeFactorSet = async ({ factors, question, paper, parentId, depth }) => {
  return factors.map((raw, i) => ({
    factorId: `${parentId || "root"}_${depth}_${i + 1}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: String(raw.name || `Factor ${i + 1}`),
    description: String(raw.description || ""),
    parentFactorId: parentId || null,
    depth,
    // Verification questions and learning content are generated only on request.
    learningContent: "",
    verificationQuestions: [],
    children: [],
    expanded: false,
  }));
};

const normalizeQuestion = (q) => ({
  question: String(q.question || "").trim(),
  options: Object.values(q.choices || q.options || {}).map(v => String(v)),
  correctAnswer: String(q.correctAnswer || "").trim().toUpperCase(),
});

const questionKey = (q) => String(q.question || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

exports.getOrGenerate = async (req, res) => {
  try {
    const { paperId, questionId, questionNumber } = req.body;
    if (!paperId || !questionId) return customErrorResponse(res, 400, "paperId and the existing questionId are required.");
    const paper = await Paper.findById(paperId);
    if (!paper) return customErrorResponse(res, 404, "Paper not found.");
    if (!(await authorizePaper(paper, req.user.id))) return customErrorResponse(res, 403, "You are not allowed to access this question.");

    // questionId is the API's existing reference field. For the current
    // plain-object Paper.questions schema, its value is questionNumber.
    const question = resolveQuestion(paper, questionId);
    if (!question) return customErrorResponse(res, 404, "The supplied question reference does not match a question number or existing question ID in this paper.");

    const displayNumber = Number(question.questionNumber || questionNumber || 0);
    let record = await R3Factor.findOne({ paper: paperId, questionId: String(questionId) });
    if (!record) {
      const prompt = `You are an expert school teacher. Analyse the exact question and identify the concept/topic actually required to solve it, not merely its chapter. Generate the topic, a secondary factor, and 2 to 5 immediate primary/root factors. Do not recursively decompose yet. For each factor provide only a concise student-friendly description. Do NOT generate learning content or verification questions at this stage. Return only JSON: {"topic":"","secondaryFactor":"","factors":[{"name":"","description":""}]}. Context: class=${paper.className}; subject=${paper.subject}; board=${paper.syllabus}; chapter=${paper.chapter_from}; language=${paper.language}. Question: ${JSON.stringify(question)}`;
      const result = await ai.generateJson(prompt);
      if (!result?.topic || !result?.secondaryFactor || !Array.isArray(result.factors) || !result.factors.length) throw new Error("AI returned an invalid R3 structure.");
      const factors = await makeFactorSet({ factors: result.factors, question, paper, parentId: null, depth: 1 });
      try {
        record = await R3Factor.create({ paper: paperId, questionId: String(questionId), questionIndex: displayNumber, originalQuestion: question, topic: result.topic, secondaryFactor: result.secondaryFactor, factors });
      } catch (e) {
        if (e.code !== 11000) throw e;
        record = await R3Factor.findOne({ paper: paperId, questionId: String(questionId) });
      }
    }
    const progress = await R3FactorProgress.find({ paper: paperId, questionId: String(questionId), user: req.user.id });
    const map = new Map(progress.map(p => [p.factorId, p]));
    return successResponse(res, 200, "R3 Factor loaded.", { _id: record._id, questionId: String(questionId), topic: record.topic, secondaryFactor: record.secondaryFactor, factors: record.factors.map(f => safeFactor(f, map)) });
  } catch (error) { console.error("R3 get/generate:", error); return errorResponse(res, error); }
};

exports.generateFactorVerificationQuestions = async (req, res) => {
  try {
    const { paperId, questionId, questionNumber, factorId } = req.body;
    if (!paperId || !questionId || !factorId) return customErrorResponse(res, 400, "paperId, questionId and factorId are required.");
    const paper = await Paper.findById(paperId);
    if (!paper) return customErrorResponse(res, 404, "Paper not found.");
    if (!(await authorizePaper(paper, req.user.id))) return customErrorResponse(res, 403, "You are not allowed to access this question.");
    const question = resolveQuestion(paper, questionId);
    if (!question) return customErrorResponse(res, 404, "Question reference does not belong to this paper.");
    const record = await R3Factor.findOne({ paper: paperId, questionId: String(questionId) });
    if (!record) return customErrorResponse(res, 404, "R3 record not found.");
    const factor = findFactor(record.factors, factorId);
    if (!factor) return customErrorResponse(res, 404, "Factor not found.");

    const progress = await R3FactorProgress.findOneAndUpdate(
      { paper: paperId, questionId: String(questionId), user: req.user.id, factorId },
      { $setOnInsert: { questionIndex: Number(questionNumber || record.questionIndex), score: 0, totalQuestions: 3, status: "Pending", attempts: 0 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const previousKeys = new Set([
      ...(progress.attemptHistory || []).flatMap(a => (a.questions || []).map(questionKey)),
      ...((progress.activeQuestionSet?.questions || []).map(questionKey)),
    ]);
    const meta = {
      originalQuestion: question,
      topic: factor.name,
      learningObjective: factor.description || `Understand ${factor.name} and how it contributes to ${record.topic}`,
      keywords: [factor.name, paper.subject, paper.chapter_from].filter(Boolean),
      language: paper.language || "English",
    };

    let chosen = null;
    // Ask the existing question generator for a fresh set; retry if it repeats a past question.
    for (let attempt = 0; attempt < 4 && !chosen; attempt++) {
      const generated = await generateVerificationQuestions(meta);
      const normalized = (generated || []).map(normalizeQuestion).filter(q => q.question && q.options.length === 4 && /^[A-D]$/.test(q.correctAnswer));
      const unique = [];
      const local = new Set();
      for (const q of normalized) {
        const key = questionKey(q);
        if (!local.has(key) && !previousKeys.has(key)) { local.add(key); unique.push(q); }
        if (unique.length === 3) break;
      }
      if (unique.length === 3) chosen = unique;
    }
    if (!chosen) return customErrorResponse(res, 502, "AI could not prepare three sufficiently new questions. Please try again.");

    const attemptId = require("crypto").randomUUID();
    progress.activeQuestionSet = { attemptId, questions: chosen };
    progress.questionIndex = Number(questionNumber || record.questionIndex);
    await progress.save();
    return successResponse(res, 200, "New verification questions generated.", {
      factorId, attemptId,
      questions: chosen.map((q, i) => ({ question: q.question, options: q.options, questionNumber: i + 1 })),
    });
  } catch (error) { console.error("R3 generate verification questions:", error); return errorResponse(res, error); }
};

exports.generateFactorLearningContent = async (req, res) => {
  try {
    const { paperId, questionId, questionNumber, factorId } = req.body;
    if (!paperId || !questionId || !factorId) {
      return customErrorResponse(res, 400, "paperId, questionId and factorId are required.");
    }

    const paper = await Paper.findById(paperId);
    if (!paper) return customErrorResponse(res, 404, "Paper not found.");
    if (!(await authorizePaper(paper, req.user.id))) {
      return customErrorResponse(res, 403, "You are not allowed to access this question.");
    }
    const question = resolveQuestion(paper, questionId);
    if (!question) return customErrorResponse(res, 404, "Question reference does not belong to this paper.");

    const record = await R3Factor.findOne({ paper: paperId, questionId: String(questionId) });
    if (!record) return customErrorResponse(res, 404, "R3 record not found.");

    const factor = findFactor(record.factors, factorId);
    if (!factor) return customErrorResponse(res, 404, "Factor not found.");

    // Reuse existing content; never spend tokens regenerating it implicitly.
    if (String(factor.learningContent || "").trim()) {
      return successResponse(res, 200, "Learning content already exists.", {
        factorId,
        learningContent: factor.learningContent,
        reused: true,
      });
    }

    const parentFactor = factor.parentFactorId
      ? findFactor(record.factors, factor.parentFactorId)
      : null;
    const language = paper.language || "English";
    const prompt = `You are an excellent school teacher and learning-content writer.
Create learning content for ONE R3 factor only.

STRICT REQUIREMENTS:
- Write approximately 150 to 200 words (target 170-180 words).
- Use language: ${language}. Do not switch languages.
- Match the learner's level: class ${paper.className || "school level"}.
- Explain the factor clearly from first principles, in student-friendly language.
- Include a simple practical or everyday-life example where relevant.
- Explain why this factor matters for understanding the question/topic.
- Keep the explanation focused on this factor; do not explain the entire chapter.
- Do not include quiz questions, MCQs, answer keys, headings unrelated to the factor, markdown tables, or promotional text.
- Return valid JSON only in this exact shape: {"learningContent":"..."}

Context:
Class: ${paper.className || ""}
Subject: ${paper.subject || ""}
Board/Syllabus: ${paper.syllabus || ""}
Chapter: ${paper.chapter_from || ""}
AI-determined topic for this question: ${record.topic || ""}
Secondary factor: ${record.secondaryFactor || ""}
${parentFactor ? `Parent factor: ${parentFactor.name}\nParent description: ${parentFactor.description || ""}` : "This is a root-level primary factor."}
Factor name: ${factor.name}
Factor description: ${factor.description || ""}
Original question this R3 structure belongs to: ${JSON.stringify(question)}
`;
    const generated = await ai.generateJson(prompt);
    const learningContent = String(generated?.learningContent || "").trim();
    if (!learningContent) throw new Error("AI did not return learning content.");

    // Save only inside this question's existing R3 document and this factor.
    factor.learningContent = learningContent;
    // children are stored as Mixed objects; explicitly mark the full factor tree modified
    // so generated content is persisted for both root and nested factors.
    record.markModified("factors");
    await record.save();

    return successResponse(res, 200, "Learning content generated successfully.", {
      factorId,
      learningContent,
      reused: false,
    });
  } catch (error) {
    console.error("R3 learning content generation:", error);
    return errorResponse(res, error);
  }
};

exports.submitFactorVerification = async (req, res) => {
  try {
    const { paperId, questionId, questionNumber, factorId, attemptId, answers } = req.body;
    if (!paperId || !questionId || !factorId || !attemptId || !Array.isArray(answers)) return customErrorResponse(res, 400, "paperId, questionId, factorId, attemptId and answers are required.");
    const paper = await Paper.findById(paperId);
    if (!paper) return customErrorResponse(res, 404, "Paper not found.");
    if (!(await authorizePaper(paper, req.user.id))) return customErrorResponse(res, 403, "You are not allowed to access this question.");
    if (!resolveQuestion(paper, questionId)) return customErrorResponse(res, 404, "Question reference does not belong to this paper.");
    const record = await R3Factor.findOne({ paper: paperId, questionId: String(questionId) });
    if (!record) return customErrorResponse(res, 404, "R3 record not found.");
    const factor = findFactor(record.factors, factorId);
    if (!factor) return customErrorResponse(res, 404, "Factor not found.");
    if (answers.length !== 3 || answers.some(a => !String(a || "").trim())) return customErrorResponse(res, 400, "Exactly 3 answers are required.");

    const progress = await R3FactorProgress.findOne({ paper: paperId, questionId: String(questionId), user: req.user.id, factorId });
    const active = progress?.activeQuestionSet;
    if (!active || String(active.attemptId) !== String(attemptId) || !Array.isArray(active.questions) || active.questions.length !== 3) {
      return customErrorResponse(res, 409, "This verification set has expired. Generate a new question set.");
    }
    const questions = active.questions;
    const score = questions.reduce((sum, q, i) => sum + (String(answers[i]).toUpperCase() === String(q.correctAnswer).toUpperCase() ? 1 : 0), 0);
    const status = score === 3 ? "Completed" : "Pending";
    const attempt = {
      attemptId: active.attemptId,
      attemptedAt: new Date(),
      questions: questions.map((q, i) => ({
        question: q.question, options: q.options, correctAnswer: q.correctAnswer,
        selectedAnswer: String(answers[i]).toUpperCase(),
        isCorrect: String(answers[i]).toUpperCase() === String(q.correctAnswer).toUpperCase(),
      })),
      score, totalQuestions: 3, status,
    };
    progress.attemptHistory = [...(progress.attemptHistory || []), attempt];
    progress.score = score;
    progress.totalQuestions = 3;
    progress.status = status;
    progress.attempts = (progress.attempts || 0) + 1;
    progress.lastAttemptAt = new Date();
    progress.activeQuestionSet = null;
    progress.questionIndex = Number(questionNumber || record.questionIndex);
    await progress.save();
    return successResponse(res, 200, "R3 verification submitted.", { score, totalQuestions: 3, status, attemptNumber: progress.attempts });
  } catch (error) { console.error("R3 submit:", error); return errorResponse(res, error); }
};

exports.expandFactor = async (req, res) => {
  try {
    const { paperId, questionId, questionNumber, factorId } = req.body;
    if (!paperId || !questionId || !factorId) return customErrorResponse(res, 400, "paperId, questionId and factorId are required.");
    const paperAccess = await Paper.findById(paperId);
    if (!paperAccess) return customErrorResponse(res, 404, "Paper not found.");
    if (!(await authorizePaper(paperAccess, req.user.id))) return customErrorResponse(res, 403, "You are not allowed to access this question.");
    if (!resolveQuestion(paperAccess, questionId)) return customErrorResponse(res, 404, "Question reference does not belong to this paper.");
    const record = await R3Factor.findOne({ paper: paperId, questionId: String(questionId) });
    if (!record) return customErrorResponse(res, 404, "R3 record not found.");
    const factor = findFactor(record.factors, factorId);
    if (!factor) return customErrorResponse(res, 404, "Factor not found.");
    const progress = await R3FactorProgress.findOne({ paper: paperId, questionId: String(questionId), user: req.user.id, factorId });
    if (progress?.status === "Completed") return customErrorResponse(res, 409, "This factor is already verified; deeper factors are not required.");
    if (!progress || progress.attempts < 1) return customErrorResponse(res, 409, "Attempt the factor verification before exploring further.");
    if (factor.children?.length) return successResponse(res, 200, "Deeper factors already exist.", { children: factor.children });
    const prompt = `Treat this failed Primary Factor as a Secondary Factor. Generate 2 to 5 immediate underlying Primary Factors only. For each provide only name and a concise student-friendly description. Do NOT generate learning content. Do not expand recursively. Return only JSON {"factors":[{"name":"","description":""}]}. Subject: ${record.originalQuestion?.subject || ""}. Parent factor: ${factor.name}. Description: ${factor.description}. Original question: ${JSON.stringify(record.originalQuestion)}`;
    const result = await ai.generateJson(prompt);
    if (!Array.isArray(result?.factors) || !result.factors.length) throw new Error("AI returned no deeper factors.");
    const paper = paperAccess;
    factor.children = await makeFactorSet({ factors: result.factors, question: record.originalQuestion, paper, parentId: factor.factorId, depth: factor.depth + 1 });
    factor.expanded = true;
    await record.save();
    const progressRows = await R3FactorProgress.find({ paper: paperId, questionId: String(questionId), user: req.user.id });
    const map = new Map(progressRows.map(p => [p.factorId, p]));
    return successResponse(res, 200, "Deeper R3 factors generated.", { children: factor.children.map(f => safeFactor(f, map)) });
  } catch (error) { console.error("R3 expand:", error); return errorResponse(res, error); }
};
