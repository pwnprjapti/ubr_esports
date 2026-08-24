import mongoose from "mongoose";

const depositSchema = new mongoose.Schema({
    playerName: { type: String, required: true },
    id: { type: String, required: true }, // user's gglId
    amount: { type: Number, required: true },
    screenshot: { type: String, required: true }, // Cloudinary URL
    status: { type: String, default: "pending" }, // pending, approved, rejected
    date: { type: Date, default: Date.now }
});

const depositModel = mongoose.model("DepositRequest", depositSchema);
export default depositModel;
