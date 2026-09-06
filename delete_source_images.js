import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';

dotenv.config();

// Source Account (Sirf isi account se images delete hongi)
const SOURCE_CONFIG = {
    cloud_name: process.env.SRC_CLOUDINARY_CLOUD_NAME,
    api_key: process.env.SRC_CLOUDINARY_API_KEY,
    api_secret: process.env.SRC_CLOUDINARY_API_SECRET
};

// 23 August 2026 ke baad ka cutoff filter
const CUTOFF_DATE = '2026-08-23';

// Cloudinary Admin API ek baar me maximum 100 images delete kar sakti hai
const BATCH_SIZE = 100;

async function deleteSourceImages() {
    console.log("==================================================");
    console.log("🗑️  SOURCE CLOUDINARY IMAGES DELETION SCRIPT");
    console.log("==================================================");
    console.log(`Targeting Source Cloud: [${SOURCE_CONFIG.cloud_name}]`);
    console.log(`Cutoff Date: Images uploaded after [${CUTOFF_DATE}]`);
    console.log("--------------------------------------------------\n");

    if (!SOURCE_CONFIG.cloud_name || !SOURCE_CONFIG.api_key || !SOURCE_CONFIG.api_secret) {
        console.error("❌ Error: .env me CLOUDINARY_CLOUD_NAME, API_KEY ya API_SECRET missing hai!");
        return;
    }

    cloudinary.config(SOURCE_CONFIG);

    // Step 1: Source Cloudinary se sabhi matching images search karna
    console.log("🔍 Source Cloudinary se images search ki ja rahi hain...");
    let allPublicIds = [];
    let nextCursor = null;

    try {
        do {
            let search = cloudinary.search
                .expression(`resource_type:image AND created_at > ${CUTOFF_DATE}`)
                .sort_by('created_at', 'asc')
                .max_results(500);

            if (nextCursor) {
                search = search.next_cursor(nextCursor);
            }

            const res = await search.execute();
            const ids = res.resources.map(img => img.public_id);
            allPublicIds = allPublicIds.concat(ids);
            nextCursor = res.next_cursor;

            console.log(`📦 Found: ${allPublicIds.length} / ${res.total_count} images...`);
        } while (nextCursor);

    } catch (err) {
        const errMsg = err?.error?.message || err?.message || JSON.stringify(err);
        console.error("❌ Images fetch karne me error:", errMsg);
        return;
    }

    if (allPublicIds.length === 0) {
        console.log(`ℹ️ Source cloud me ${CUTOFF_DATE} ke baad ki koi images nahi mili.`);
        return;
    }

    console.log(`\n⚠️  KUL ${allPublicIds.length} IMAGES MILI HAIN JO DELETE HONGI.`);
    console.log("🗑️  Deletion shuru ho raha hai...\n");

    let totalDeleted = 0;
    let totalNotFound = 0;
    let failedList = [];

    // Step 2: 100-100 ke batches me images delete karna (Fast & Safe)
    for (let i = 0; i < allPublicIds.length; i += BATCH_SIZE) {
        const batch = allPublicIds.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(allPublicIds.length / BATCH_SIZE);

        try {
            console.log(`⏳ Batch [${batchNumber}/${totalBatches}] deleting ${batch.length} images...`);
            
            const result = await cloudinary.api.delete_resources(batch, {
                resource_type: 'image',
                invalidate: true // CDN cache clear karega
            });

            // Count deleted status
            for (const [id, status] of Object.entries(result.deleted || {})) {
                if (status === 'deleted') {
                    totalDeleted++;
                } else if (status === 'not_found') {
                    totalNotFound++;
                } else {
                    failedList.push({ public_id: id, status });
                }
            }

            console.log(`✅ Batch [${batchNumber}/${totalBatches}] complete.`);

            // Chota sa delay (100ms) taaki API rate limit par asar na pade
            await new Promise(r => setTimeout(r, 100));
        } catch (err) {
            console.error(`❌ Batch [${batchNumber}/${totalBatches}] failed:`, err.message);
            failedList.push({ batch: batchNumber, error: err.message });
        }
    }

    console.log("\n==================================================");
    console.log("🎉 DELETION COMPLETED");
    console.log("==================================================");
    console.log(`✅ Successfully Deleted: ${totalDeleted}`);
    console.log(`ℹ️ Already Not Found: ${totalNotFound}`);
    console.log(`❌ Failed: ${failedList.length}`);

    if (failedList.length > 0) {
        console.log("\nFailed Items:");
        console.table(failedList);
    }
}

deleteSourceImages();
