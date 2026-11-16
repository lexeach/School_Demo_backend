require("dotenv").config();
const mongoose = require("mongoose");

async function migrateCollection(collectionName, targetKeys) {
  const collection = mongoose.connection.collection(collectionName);
  // Backfill only the R3 lookup key from the already-stored questionIndex.
  // This does not touch Paper.questions or create/change any question ID.
  const backfill = await collection.updateMany(
    { questionId: { $exists: false }, questionIndex: { $exists: true } },
    [{ $set: { questionId: { $toString: "$questionIndex" } } }]
  );
  console.log(`${collectionName}: backfilled ${backfill.modifiedCount || 0} R3 lookup keys from questionIndex`);
  const indexes = await collection.indexes();
  for (const index of indexes) {
    if (index.name === "_id_") continue;
    const keys = Object.keys(index.key || {});
    const isOldQuestionIndex =
      keys.length === 2 &&
      index.key.paper === 1 &&
      index.key.questionIndex === 1 &&
      index.unique === true;
    if (isOldQuestionIndex) {
      console.log(`Dropping obsolete unique index ${collectionName}.${index.name}`);
      await collection.dropIndex(index.name);
    }
  }
  const existing = await collection.indexes();
  const wanted = existing.find(i =>
    Object.keys(i.key || {}).join(",") === Object.keys(targetKeys).join(",") &&
    Object.keys(targetKeys).every(k => i.key[k] === targetKeys[k])
  );
  if (!wanted) {
    await collection.createIndex(targetKeys, {
      unique: true,
      partialFilterExpression: { questionId: { $type: "string" } }
    });
    console.log(`Created questionId index on ${collectionName}`);
  } else {
    console.log(`questionId index already exists on ${collectionName}`);
  }
}

(async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is missing");
  await mongoose.connect(process.env.MONGO_URI);
  await migrateCollection("r3factors", { paper: 1, questionId: 1 });
  await migrateCollection("r3factorprogresses", { paper: 1, questionId: 1, user: 1, factorId: 1 });
  await mongoose.disconnect();
  console.log("R3 index migration completed. Existing question IDs/documents were not modified.");
})().catch(async error => {
  console.error("R3 index migration failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
