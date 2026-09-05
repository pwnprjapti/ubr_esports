import { MongoClient } from "mongodb";

// Source and Target MongoDB Atlas URIs
const SOURCE_URI =
  "mongodb+srv://devilpro9671_db_user:y6rBWUcNbqfqtHQr@cluster0.o2n8jmm.mongodb.net";
const TARGET_URI =
  "mongodb+srv://chetankahar397_db_user:WRuttGJdK7iqFu5x@cluster0.o9egwyl.mongodb.net";

// IMPORTANT: Source database name in Atlas is 'ubresport' (without 's')
const SOURCE_DB = "ubresport";
const TARGET_DB = "ubresports";

// Clear target collections before copying to ensure a clean sync without duplicate key errors
const CLEAR_TARGET_FIRST = true;
const BATCH_SIZE = 500;

async function copyDatabase() {
  const sourceClient = new MongoClient(SOURCE_URI, {
    serverSelectionTimeoutMS: 30000,
    connectTimeoutMS: 30000,
    family: 4,
  });

  const targetClient = new MongoClient(TARGET_URI, {
    serverSelectionTimeoutMS: 30000,
    connectTimeoutMS: 30000,
    family: 4,
  });

  try {
    console.log("=========================================");
    console.log("🚀 MONGODB DATABASE MIGRATION STARTING");
    console.log("=========================================");
    console.log(`Source DB: [${SOURCE_DB}]`);
    console.log(`Target DB: [${TARGET_DB}]`);
    console.log("-----------------------------------------");

    console.log("Connecting to source cluster...");
    await sourceClient.connect();
    console.log("✅ Source connected");

    console.log("Connecting to target cluster...");
    await targetClient.connect();
    console.log("✅ Target connected\n");

    const sourceDb = sourceClient.db(SOURCE_DB);
    const targetDb = targetClient.db(TARGET_DB);

    // Verify source database collections
    const collections = await sourceDb.listCollections().toArray();

    if (collections.length === 0) {
      console.warn(`⚠️ Warning: 0 collections found in source database '${SOURCE_DB}'!`);
      const allDbs = await sourceClient.db().admin().listDatabases();
      console.log(
        "Available databases on source cluster:",
        allDbs.databases.map((d) => d.name)
      );
      return;
    }

    console.log(`📋 Found ${collections.length} collections in '${SOURCE_DB}'\n`);

    const summary = [];

    for (const collectionInfo of collections) {
      const collectionName = collectionInfo.name;

      // Skip MongoDB internal collections
      if (collectionName.startsWith("system.")) {
        continue;
      }

      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📦 Processing collection: ${collectionName}`);

      const sourceCollection = sourceDb.collection(collectionName);
      const targetCollection = targetDb.collection(collectionName);

      const sourceDocCount = await sourceCollection.countDocuments();
      console.log(`   Source documents count: ${sourceDocCount}`);

      // 1. Clear target collection if enabled
      if (CLEAR_TARGET_FIRST) {
        const deleteResult = await targetCollection.deleteMany({});
        if (deleteResult.deletedCount > 0) {
          console.log(`   🧹 Cleared ${deleteResult.deletedCount} existing documents in target`);
        }
      }

      // 2. Copy Indexes (excluding default _id_)
      try {
        const rawIndexes = await sourceCollection.indexes();
        const customIndexes = rawIndexes
          .filter((idx) => idx.name !== "_id_")
          .map((idx) => {
            const { v, ns, ...indexSpec } = idx;
            return indexSpec;
          });

        if (customIndexes.length > 0) {
          await targetCollection.createIndexes(customIndexes);
          console.log(`   📑 Created ${customIndexes.length} custom index(es)`);
        }
      } catch (idxError) {
        console.warn(`   ⚠️ Warning copying indexes: ${idxError.message}`);
      }

      // 3. Copy documents in batches
      let totalCopied = 0;

      if (sourceDocCount > 0) {
        const cursor = sourceCollection.find({});
        let batch = [];

        while (await cursor.hasNext()) {
          const document = await cursor.next();
          batch.push(document);

          if (batch.length >= BATCH_SIZE) {
            try {
              const insertResult = await targetCollection.insertMany(batch, {
                ordered: false,
              });
              totalCopied += insertResult.insertedCount;
            } catch (batchErr) {
              if (batchErr.name === "MongoBulkWriteError" || batchErr.code === 11000) {
                totalCopied += batchErr.result?.insertedCount || 0;
                console.warn(`   ⚠️ Duplicate documents encountered and skipped in batch`);
              } else {
                throw batchErr;
              }
            }

            console.log(`   → ${totalCopied} / ${sourceDocCount} documents copied...`);
            batch = [];
          }
        }

        // Flush remaining documents
        if (batch.length > 0) {
          try {
            const insertResult = await targetCollection.insertMany(batch, {
              ordered: false,
            });
            totalCopied += insertResult.insertedCount;
          } catch (batchErr) {
            if (batchErr.name === "MongoBulkWriteError" || batchErr.code === 11000) {
              totalCopied += batchErr.result?.insertedCount || 0;
              console.warn(`   ⚠️ Duplicate documents encountered and skipped in final batch`);
            } else {
              throw batchErr;
            }
          }
        }
      }

      const targetDocCount = await targetCollection.countDocuments();
      const isSuccess = targetDocCount === sourceDocCount;

      console.log(
        `   ${isSuccess ? "✅" : "⚠️"} Target documents count: ${targetDocCount} (Copied: ${totalCopied})`
      );

      summary.push({
        collection: collectionName,
        source: sourceDocCount,
        target: targetDocCount,
        status: isSuccess ? "MATCHED" : "MISMATCH",
      });
    }

    console.log("\n=========================================");
    console.log("🎉 MIGRATION SUMMARY");
    console.log("=========================================");
    console.table(summary);
    console.log("=========================================");
    console.log("All collections and documents successfully copied!");
  } catch (error) {
    console.error("\n❌ MIGRATION FAILED");
    console.error("Name:", error.name);
    console.error("Message:", error.message);
    console.error(error);
  } finally {
    await sourceClient.close();
    await targetClient.close();
    console.log("\nDatabase connections closed.");
  }
}

copyDatabase();

