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
    verificationQuestions: (factor.verificationQuestions || []).map((q, i) => ({
      question: q.question, options: q.options, questionNumber: i + 1
    })),
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
  const output = [];
  for (let i = 0; i < factors.length; i++) {
    const raw = factors[i];
    const factorId = `${parentId || "root"}_${depth}_${i + 1}_${Date.now().toString(36)}`;
    const meta = {
      topic: raw.name,
      learningObjective: raw.description || `Understand ${raw.name} and how it contributes to ${question.question}`,
      keywords: [raw.name, paper.subject, paper.chapter_from].filter(Boolean),
    };
    const generated = await generateVerificationQuestions({
      originalQuestion: question,
      ...meta,
      language: paper.language || "English",
    });
    const questions = generated.slice(0, 3).map(q => ({
      question: q.question,
      options: Object.values(q.choices || q.options || {}),
      correctAnswer: q.correctAnswer,
    }));
    if (questions.length !== 3 || questions.some(q => !q.question || q.options.length < 2 || !q.correctAnswer)) {
      throw new Error(`AI did not generate a valid 3-question set for ${raw.name}`);
    }
    output.push({
      factorId,
      name: String(raw.name || `Factor ${i + 1}`),
      description: String(raw.description || ""),
      parentFactorId: parentId || null,
      depth,
      // Learning content is intentionally blank until the student requests it.
      learningContent: "",
      verificationQuestions: questions,
      children: [],
      expanded: false,
    });
  }
  return output;
};

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
      const prompt = `You are an expert school teacher. Analyse the exact question and identify the concept/topic actually required to solve it, not merely its chapter. Generate the topic, a secondary factor, and 2 to 5 immediate primary/root factors. Do not recursively decompose yet. For each factor provide only a concise student-friendly description. Do NOT generate learning content. The system generates a separate verification set for every factor. Return only JSON: {"topic":"","secondaryFactor":"","factors":[{"name":"","description":""}]}. Context: class=${paper.className}; subject=${paper.subject}; board=${paper.syllabus}; chapter=${paper.chapter_from}; language=${paper.language}. Question: ${JSON.stringify(question)}`;
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
    const { paperId, questionId, questionNumber, factorId, answers } = req.body;
    if (!paperId || !questionId || !factorId || !Array.isArray(answers)) return customErrorResponse(res, 400, "paperId, questionId, factorId and answers are required.");
    const paper = await Paper.findById(paperId);
    if (!paper) return customErrorResponse(res, 404, "Paper not found.");
    if (!(await authorizePaper(paper, req.user.id))) return customErrorResponse(res, 403, "You are not allowed to access this question.");
    if (!resolveQuestion(paper, questionId)) return customErrorResponse(res, 404, "Question reference does not belong to this paper.");
    const record = await R3Factor.findOne({ paper: paperId, questionId: String(questionId) });
    if (!record) return customErrorResponse(res, 404, "R3 record not found.");
    const factor = findFactor(record.factors, factorId);
    if (!factor) return customErrorResponse(res, 404, "Factor not found.");
    if (answers.length !== 3) return customErrorResponse(res, 400, "Exactly 3 answers are required.");
    const score = factor.verificationQuestions.reduce((sum, q, i) => sum + (String(answers[i]) === String(q.correctAnswer) ? 1 : 0), 0);
    const status = score === 3 ? "Completed" : "Pending";
    await R3FactorProgress.findOneAndUpdate(
      { paper: paperId, questionId: String(questionId), user: req.user.id, factorId },
      { $set: { questionIndex: Number(questionNumber || record.questionIndex), score, totalQuestions: 3, status, lastAttemptAt: new Date() }, $inc: { attempts: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return successResponse(res, 200, "R3 verification submitted.", { score, totalQuestions: 3, status });
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
