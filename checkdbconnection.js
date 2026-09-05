import "dotenv/config";
import { MongoClient } from "mongodb";

const SOURCE_URI = process.env.MONGO_URI;

async function testSource() {
  const client = new MongoClient(SOURCE_URI, {
    serverSelectionTimeoutMS: 30000,
    connectTimeoutMS: 30000,
    family: 4,
  });

  try {
    await client.connect();

    console.log("✅ MongoDB connected");

    // Atlas connection check
    const adminDb = client.db("admin");

    const ping = await adminDb.command({ ping: 1 });
    console.log("Ping:", ping);

    // IMPORTANT: exact database
    const db = client.db("ubresports");

    console.log("Database:", db.databaseName);

    // Collections
    const collections = await db
      .listCollections({})
      .toArray();

    console.log("\nCollections:");

    for (const collection of collections) {
      console.log(" -", collection.name);
    }

    console.log(`\nTotal collections: ${collections.length}`);

    // Database stats
    const stats = await db.stats();

    console.log("\nDatabase stats:");
    console.log({
      collections: stats.collections,
      objects: stats.objects,
      dataSize: stats.dataSize,
      storageSize: stats.storageSize,
    });

  } catch (error) {
    console.error("\n❌ ERROR");
    console.error("Name:", error.name);
    console.error("Message:", error.message);
    console.error(error);
  } finally {
    await client.close();
  }
}

testSource();
