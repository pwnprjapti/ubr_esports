import mongoose from "mongoose";
import userModel from "./models/user.model.js";
import dotenv from "dotenv";

dotenv.config();

const migrateTeamIds = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);

        console.log("MongoDB connected");

        const users = await userModel.find({}).lean();

        console.log("Total users:", users.length);

        const operations = [];

        for (const user of users) {

            if (!user.team) {
                console.log(`Skipping ${user._id}: team doesn't exist`);
                continue;
            }

            // Agar existing document mein team._id nahi hai
            if (!user.team._id) {

                operations.push({
                    updateOne: {
                        filter: {
                            _id: user._id
                        },
                        update: {
                            $set: {
                                "team._id": new mongoose.Types.ObjectId()
                            }
                        }
                    }
                });
            }
        }

        console.log("Users to update:", operations.length);

        if (operations.length > 0) {
            const result = await userModel.bulkWrite(operations);

            console.log("Matched:", result.matchedCount);
            console.log("Modified:", result.modifiedCount);
        }

        console.log("Migration completed!");

    } catch (error) {
        console.error("Migration error:", error);
    } finally {
        await mongoose.connection.close();
        console.log("MongoDB connection closed");
    }
};

migrateTeamIds();
