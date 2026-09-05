import dotenv from "dotenv";
import mongoose from "mongoose";
import userModel from "./models/user.model.js";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://devilpro9671_db_user:y6rBWUcNbqfqtHQr@cluster0.o2n8jmm.mongodb.net/ubresport?retryWrites=true&w=majority&appName=Cluster0";
const TARGET_GGL_ID = "104280319321734344995";
const DEDUCT_AMOUNT = 60;

async function deductBalance() {
    try {
        console.log("Connecting to MongoDB...");
        await mongoose.connect(MONGO_URI);
        console.log("Connected successfully.\n");

        // 1. User find karein
        const userBefore = await userModel.findOne({ gglId: TARGET_GGL_ID });
        if (!userBefore) {
            console.log(`❌ User with gglId ${TARGET_GGL_ID} not found.`);
            await mongoose.disconnect();
            return;
        }

        const oldBalance = userBefore.wallet?.balance?.availableBalance ?? 0;
        console.log(`Found User: ${userBefore.team?.teamName || "N/A"}`);
        console.log(`Google ID (gglId): ${userBefore.gglId}`);
        console.log(`Current wallet.balance.availableBalance: ${oldBalance}`);

        // 2. availableBalance me se 60 minus karein
        const updatedUser = await userModel.findOneAndUpdate(
            { gglId: TARGET_GGL_ID },
            { $inc: { "wallet.balance.availableBalance": -DEDUCT_AMOUNT } },
            { returnDocument: 'after' }
        );

        const newBalance = updatedUser.wallet?.balance?.availableBalance;
        console.log(`\n✅ 60 minus kar diya gaya!`);
        console.log(`Purana Balance: ${oldBalance}`);
        console.log(`Naya availableBalance: ${newBalance}`);

    } catch (error) {
        console.error("Error updating balance:", error);
    } finally {
        await mongoose.disconnect();
        console.log("\nDisconnected from MongoDB.");
    }
}

deductBalance();
