import mongoose from "mongoose";

const depositSchema = new mongoose.Schema({
    orderId: { type: String, unique: true, sparse: true },
    playerName: { type: String, required: true },
    id: { type: String, required: true }, // user's gglId
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    screenshot: { type: String, default: "" }, // Optional legacy screenshot URL
    status: { type: String, default: "pending" }, // pending, approved, failed
    utr: { type: String, default: "" },
    gatewayTxnId: { type: String, default: "" },
    paymentMethod: { type: String, default: "UPI QR" },
    provider: { type: String, default: "paytm" },
    paymentUrl: { type: String, default: "" },
    paidAt: { type: Date },
    date: { type: Date, default: Date.now }
});

const depositModel = mongoose.model("DepositRequest", depositSchema);
export default depositModel;
